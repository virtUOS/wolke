# Runbook: revoke a compromised admin

Who: whoever holds IdP-admin rights (Keycloak/Authentik/Zitadel/Entra/…
admin console access) plus, for the immediate-lockout step, database access
to the wolke Postgres instance. This is a two-part problem: (1) make sure the
account is no longer *granted* admin going forward, and (2) make sure any
*already-open* wolke session for that account is killed **now**, not next
login.

wolke's admin flag is not a role stored in wolke's own user table that you
edit directly — it is **re-derived from the IdP on every login**
(`ResolveAdmin` in `internal/auth/resolve.go`, driven by
`oidc.admin.claim`/`oidc.admin.match` in `config.yaml`). So step 1 alone is
not enough for immediate lockout if the compromised session is still live.

---

## Part 1 — revoke admin at the IdP (stops future logins from being admin)

wolke is provider-agnostic: whatever claim/group your `config.yaml` maps to
`is_admin` (see `oidc.admin.claim` / `oidc.admin.match`) is the thing to
remove the user from. Check your `config.yaml`:

```yaml
oidc:
  admin:
    claim: groups          # example: could be any claim name, incl. a nested
                            # dot-path like realm_access.roles
    match: dashboard-admins
```

1. Find the exact claim/group name from `config.yaml` on the running deploy
   (`admin.claim` + `admin.match`).
2. At your IdP, remove the compromised user from that group / role /
   claim-granting assignment.

   **e.g., if you're using Keycloak** (concrete steps — any OIDC-compliant IdP
   has an equivalent): **Users → (the user) → Groups tab → leave the group**
   named in `admin.match` (default recipe in `docs/oidc-keycloak.md` uses a
   `dashboard-admins` group), or if you mapped admin via realm roles instead,
   **Users → (the user) → Role mapping → unassign** the matching role.
3. This alone does **not** end the user's current wolke session — see Part 2.
4. Confirm at next login (or ask the user, if this isn't the compromised
   account itself, to log out and back in) that **Administration** no longer
   appears in their account menu, and `GET /api/me` no longer reports
   `is_admin: true`.

## Part 2 — force immediate session termination (don't wait for next login)

Because `is_admin` (and role) are only re-derived at login time, a session
opened *before* you did Part 1 keeps its admin rights until it naturally
expires — unless you end it. wolke supports two mechanisms; use whichever is
faster for your situation.

### Option A — trigger IdP-side logout (preferred, if back-channel logout is configured)

wolke implements OIDC Back-Channel Logout 1.0
(`internal/auth/backchannel.go`, `POST /auth/backchannel-logout`). If your
IdP client has its **Backchannel logout URL** registered (see
`docs/oidc-keycloak.md` — `PUBLIC_URL` + `/auth/backchannel-logout`), forcing
a logout at the IdP for that user's session(s) makes the IdP POST a signed
logout token to wolke, which immediately deletes the matching session
row(s) — no cooperation from the user's browser required, so this works even
on a shared/lab machine.

**e.g., if you're using Keycloak:** **Users → (the user) → Sessions tab →
Sign out** (or, for a session-wide nuke, **Sessions → realm-wide "Logout
all"** — heavier-handed, logs out everyone). This ends the IdP session, which
Keycloak then reports server-to-server to wolke's backchannel endpoint.

Two important details from the actual implementation:
- If the IdP's logout token carries a `sid` (session id) claim — which
  requires **"Backchannel logout session required"** to be enabled on the
  client at the IdP — wolke ends exactly that one wolke session
  (`DeleteSessionsBySID`). If `sid` is absent, wolke falls back to ending
  **every** wolke session for that user's `sub`
  (`DeleteSessionsByOIDCSub`) — broader, but still correct for a compromise
  where you want *all* of that user's sessions gone.
- Confirm it worked: the server logs a structured line
  `{"msg":"backchannel logout accepted", "sessions_ended": N, ...}`. `N > 0`
  means it found and killed a session; `N == 0` means there was no matching
  live session (already expired, or the sid/sub didn't match — double-check
  you targeted the right user).

If back-channel logout is **not** registered for your IdP client, Option A
does nothing (the IdP has no wolke endpoint to call) — go straight to Option B.

### Option B — end the session directly in Postgres (works regardless of IdP config)

There is currently **no admin-facing wolke API or MCP tool to force-end a
specific user's session** — `DeleteSessionsByOIDCSub`/`DeleteSessionsBySID`
(`internal/store/queries/sessions.sql`) are only ever invoked from the
back-channel logout handler, not exposed as an admin action. Until that gap
is closed, the reliable immediate-lockout path is a direct database delete:

1. Get a `psql` shell against the running database (see
   `docs/runbooks/restore-postgres.md` for the `docker compose exec` pattern
   against `compose.yaml`/`compose.prod.yaml`'s `postgres` service), or use
   `make db` port `5432` in a local/staging setup.
2. Find the user's `oidc_sub` (also handy to have on file before an incident —
   it's the same value used for `MCP_ADMIN_SUB` if this happens to be the MCP
   admin):
   ```sql
   select id, oidc_sub, display_name, is_admin from users where email = 'compromised.user@example.edu';
   ```
3. Delete every session for that user (mirrors exactly what back-channel
   logout does for a sub-only logout token):
   ```sql
   delete from sessions using users
   where sessions.user_id = users.id and users.oidc_sub = '<oidc_sub from step 2>';
   ```
4. The next request from that browser gets a 401/redirect-to-login — that's
   your immediate lockout, independent of whatever the IdP-side revocation
   in Part 1 will enforce at the next login attempt.

## Part 3 — if the compromised account is (or might be) the MCP admin

If `MCP_ADMIN_SUB` (see README → "Admin MCP server") is set to this user's
`oidc_sub`, the running `bin/mcp` process keeps acting as that identity for
every `change.confirm` write until it's restarted with a different
`MCP_ADMIN_SUB` — the MCP server has no session to revoke (it isn't a
browser session at all, just an env var read at process start). Rotate
`MCP_ADMIN_SUB` to a different admin's `oidc_sub` and restart the MCP process.

## Verification checklist

- [ ] User removed from the admin-granting group/role at the IdP (Part 1).
- [ ] `sessions_ended > 0` in the backchannel logout log, **or** a direct
      `delete from sessions … where oidc_sub = …` was run and returned rows
      deleted (Part 2).
- [ ] A subsequent request from the compromised browser is unauthenticated
      (401 / redirected to login).
- [ ] If applicable, `MCP_ADMIN_SUB` rotated and the MCP process restarted
      (Part 3).
- [ ] Check `GET /api/admin/audit` (Administration → Audit) for any writes
      by this admin around the suspected compromise window — `actor_kind`
      `form` or `mcp`, review each `diff` for anything that needs undoing.
