# Spec — M3: OIDC back-channel logout + auth security review

Status: **ready to implement** · Owner: supervisor session · Written 2026-08-28
Issue: **#44** ("Backchannel logout doesn't seem to work") · Milestone: M3
Run with: **fable, new session off `main`.**

## 1. Why and what's actually missing

Logging out of the university SSO leaves the user logged into wolke (#44). That's expected
with the current code: wolke only implements **RP-initiated** logout (its own logout button
redirects to the discovered `end_session_endpoint`). Nothing exists for the reverse direction —
the IdP telling wolke that a session ended. On shared and pool computers this is a real
security gap, so it's a production requirement, not polish.

Confirmed by reading `internal/auth` (2026-08-28):
- Sessions: `sessions(id, user_id, data, created_at, expires_at)` (originally migration 00001,
  now part of the flattened `migrations/00001_init.sql` baseline), token
  hashed via `hashToken`; `SessionStore` has `New/Lookup/Delete` **by token only**.
- The `sid` claim from the ID token is **not captured anywhere** — there is currently no way
  to find "the wolke session belonging to this IdP session".
- `Authenticator` already discovers `end_session_endpoint` and holds the provider's JWKS
  verifier machinery (coreos/go-oidc) — reuse it for logout-token verification.

Scope: **OIDC Back-Channel Logout 1.0** (server-to-server; works with the BFF pattern and
needs no browser cooperation). Front-channel logout is out of scope — it depends on
third-party-cookie behavior that browsers are killing, and Keycloak supports back-channel.

## 2. Design

### 2.1 Capture the IdP session at login
- Migration `00015` (now flattened into `migrations/00001_init.sql`): `alter table sessions add column oidc_sid text`, plus
  `create index sessions_oidc_sid_idx on sessions (oidc_sid) where oidc_sid is not null`.
  Nullable — not every IdP sends `sid`, and old rows have none.
- In `Callback`, extract the `sid` claim from the verified ID-token claims (it's already a
  `map[string]any`) and pass it to `SessionStore.New`. Also make sure the user's `oidc_sub`
  remains reachable from a session (it is, via `users`).

### 2.2 The endpoint: `POST /auth/backchannel-logout`
Registered unauthenticated (like `/auth/callback`), CSRF-exempt (server-to-server,
form-encoded `logout_token=<jwt>`), `Cache-Control: no-store` on responses per the spec.

Validation of the logout token (OIDC Back-Channel Logout 1.0 §2.4–2.6), all in one pure-ish
function so it's table-testable:
1. Signature against the provider JWKS; `iss` matches the configured issuer; `aud` contains
   our `client_id`; `iat` fresh (allow small skew; reject older than ~5 min); `exp` required
   and honored with the same skew (the final Back-Channel Logout 1.0 spec makes `exp`
   REQUIRED — earlier drafts had it optional).
2. `events` claim contains the key `http://schemas.openid.net/event/backchannel-logout`.
3. **`nonce` must be absent** (spec requirement — distinguishes it from an ID token).
4. At least one of `sid` / `sub` present.
5. Replay: remember seen `jti` in a small in-process TTL cache (single instance per docs/02
   §9 — note in a comment that multi-instance would move this to shared storage).

Revocation:
- `sid` present → delete the session row(s) with that `oidc_sid`.
- Only `sub` → delete **all** sessions of the user with that `oidc_sub` (the spec's meaning:
  the IdP couldn't say which session, so end them all). Add
  `SessionStore.DeleteBySID(ctx, sid)` and `DeleteByOIDCSub(ctx, sub)` via sqlc.
- Respond `200` even when nothing matched (the session may already be expired — that's
  success, and it avoids an oracle for valid sids). Invalid token → `400` problem+json,
  logged at warn with the failure reason (never the token itself).

Log every accepted logout event via slog (issuer, sid/sub hash, sessions ended) — this is a
security-relevant event stream, but it is **not** an admin catalog write, so no `audit_log`
row and no service-layer involvement; it stays in `internal/auth` beside login/logout.

### 2.3 Provider-agnostic (golden rule 8)
The endpoint exists unconditionally; deployments enable the feature purely by registering the
URL at their IdP. No Keycloak-specific code. Document in `docs/oidc-keycloak.md`:
Keycloak client → Settings → *Backchannel logout URL* = `${PUBLIC_URL}/auth/backchannel-logout`,
*Backchannel logout session required* = on. Mention that Authentik/Zitadel/Entra offer
equivalents and the URL is the only wolke-side knob. Update the README auth section and
`config.example.yaml` comments.

## 3. Tests (the hard part — do these first)

- **Logout-token validation, table-driven** against a local JWKS test double (httptest server
  serving a generated keyset; sign tokens with the test key — same pattern go-oidc uses in its
  own tests). Cases: happy path (sid), happy path (sub only), wrong issuer, wrong audience,
  bad signature, missing events key, wrong events key, `nonce` present, neither sid nor sub,
  stale `iat`, replayed `jti`.
- **Integration (real Postgres)**: login-shaped session rows with `oidc_sid` set → POST a
  valid logout token → the matching session's next `Lookup` fails; other users' and other-sid
  sessions untouched; sub-only token ends all of that user's sessions.
- **End-to-end shape**: an httptest round-trip through the real router — session cookie works,
  back-channel logout lands, the next `/api/me` with the old cookie is 401.
- The existing auth tests keep passing; `sid` absent (mock IdP without sid) must not break
  login — sessions simply get a NULL `oidc_sid`.
- Manual verification checklist for staging (documented in the PR): log in to wolke, log out
  at Keycloak account console, wolke request is unauthenticated within seconds.

## 4. Part two — focused auth security review

After the implementation lands (same session), run `/security-review` over `internal/auth` +
session wiring, and explicitly check, beyond whatever it finds:
- cookie flags (`Secure`/`HttpOnly`/`SameSite`) under `PUBLIC_URL` http vs https;
- `sanitizeReturnTo` open-redirect coverage (protocol-relative `//evil`, backslashes, tabs);
- session fixation (new token on login — never reuse), logout deleting server-side state;
- handshake cookie integrity (state/PKCE binding, replay);
- the new endpoint: no user enumeration via response differences, request-size limit on the
  posted form, rate limiting consistent with docs/02 §10.
Fix what's cheap in the same PR series; file the rest as issues with severity labels.

## 5. Definition of done
- #44 closes with the integration test demonstrating IdP-initiated logout ending the session.
- Migration forward-only; `sid`-less IdPs unaffected; no Keycloak-specific code paths.
- Docs updated (`docs/02` §6 auth flow, `docs/oidc-keycloak.md`, README).
- Security-review findings triaged: fixed or filed.
- Full gates green: `go test -race ./...`, vitest, tsc, lints, `make e2e`.
