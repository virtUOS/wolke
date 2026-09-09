# Runbook: grant or revoke access to a restricted service group

Who: whoever holds IdP-admin rights (Keycloak/Authentik/Zitadel/Entra/… admin
console access). No database access and no wolke deploy is needed for the
day-to-day grant/revoke — only for the one-time setup in Part 0, which is a
`config.yaml` change plus a restart.

What this covers: a **category** restricted to a **visibility group** — e.g. the
IT-infrastructure services that normal users must not see (issue #121,
`docs/specs/service-visibility.md`). Restriction lives on the category and
covers every service in it. Membership is decided by the IdP, orthogonally to
roles: an IT admin is still `staff` for their normal view.

The one thing to internalise: **membership is re-derived on every login**, the
same contract as `is_admin` (`ResolveVisibilityClaims` in
`internal/auth/resolve.go`, driven by the `visibility:` block in `config.yaml`).
Adding someone to the group takes effect at their next login; removing them
revokes at their next login, **not** immediately — see Part 3 if you need the
access gone now.

Beta services are a different thing entirely: a service tagged `beta` is hidden
until the user switches on "Beta-Dienste anzeigen" in their own account menu. No
IdP, no configuration, nothing in this runbook applies to them.

---

## Part 0 — one-time setup (only if the group doesn't exist yet)

1. **Check the config.** On the running deploy, look at the top-level
   `visibility:` block of `config.yaml`:

   ```yaml
   visibility:
     - slug: it-infra
       label: { de: "IT-Infrastruktur", en: "IT infrastructure" }
       claim: groups                  # which claim carries membership
       match: it-service-admins       # the value that grants the group
   ```

   `claim` supports nested dot-paths (`realm_access.roles`), exactly like
   `oidc.admin.claim`. `label` is optional — leave it out and the admin
   selector reads as the capitalized slug. Adding or changing an entry needs a restart —
   `config.yaml` is read at startup, and an invalid slug fails startup loudly.
2. **Create the group at the IdP** with the name in `match`, and make sure the
   claim in `claim` actually reaches the **ID token**. This is the one trap:
   a Keycloak Group Membership mapper with "Add to ID token" off grants nobody
   anything, silently. Full recipe: `docs/oidc-keycloak.md` §3c.
3. **Restrict the category.** In wolke: **Administration → Kategorien →** (the
   category) **→ Bearbeiten → Sichtbarkeit →** the group's label; create the
   category first (**Kategorie anlegen**) if it does not exist yet, and move the
   services into it from **Administration → Dienste**. Public is the default and
   stays the default; one group per category. The write is audited like any
   other catalog change (**Administration → Audit**).

   **The service form has no visibility control** — it only shows a hint naming
   the group the chosen categories imply. That is deliberate: assigning a
   service to "IT-Infrastruktur" *is* restricting it, and one place to look
   beats two. A service in several categories is visible only to someone who
   holds **every** restricted one of them.

## Part 1 — grant access to a user

1. At the IdP, add the user to the group named in `match`.

   **e.g., if you're using Keycloak:** **Users → (the user) → Groups tab →
   Join Group →** the group (e.g. `it-service-admins`).
2. Tell the user to **log out and log back in**. Nothing appears until they do.
3. Verify: after their next login the server logs
   `{"msg":"login","sub":…,"visibility":["it-infra"]}` — the slugs are named in
   the login line. From the user's side, `GET /api/me` reports the slug under
   `visibility.held`, and the restricted category and its services show up in
   the normal views like any other.

   An empty `visibility` list in the login line while the user *is* in the
   group means the claim never arrived: re-check "Add to ID token" and whether
   the claim carries full group paths (`/it-service-admins`) — see the
   troubleshooting table in `docs/oidc-keycloak.md`.

## Part 2 — revoke access

1. At the IdP, remove the user from the group.

   **e.g., if you're using Keycloak:** **Users → (the user) → Groups tab →
   Leave** the group.
2. **Revocation lands at their next login.** Until then, an already-open wolke
   session keeps the slug it was granted with: the held set is re-derived from
   claims at login, not per request.
3. Verify at their next login: the `visibility` list in the login line no
   longer names the slug, `GET /api/me` no longer reports it under
   `visibility.held`, and the restricted category and its services are gone from
   that user's views entirely.

Nothing else needs cleaning up: a favourite pointing at a service the user can
no longer see simply drops out of their favourites, the same way a soft-deleted
service does. If they are re-added later, it comes back.

## Part 3 — when "next login" isn't fast enough

Same shape as a compromised admin, same two options — so rather than repeat
them, use **`docs/runbooks/revoke-admin.md` Part 2** verbatim; only the reason
differs:

- **Option A (preferred): a back-channel logout at the IdP ends the session
  now.** Keycloak: **Users → (the user) → Sessions → Sign out**. The IdP POSTs
  a signed logout token to `POST /auth/backchannel-logout` and wolke deletes
  the session immediately; the log line
  `{"msg":"backchannel logout accepted", …, "sessions_ended":1}` confirms it.
  Their next request is unauthenticated, and the login that follows re-derives
  the held set without the group.
- **Option B: delete the session rows directly in Postgres** (works regardless
  of IdP configuration) — the exact SQL is in that runbook.

## Verification checklist

- [ ] The group at the IdP matches `match` in the `visibility:` entry, and its
      claim reaches the **ID token**.
- [ ] The affected user logged out and back in (grant *and* revoke both need
      this).
- [ ] The login log line names — or no longer names — the slug under
      `visibility`.
- [ ] For a revocation that had to be immediate: the session was ended (Part 3)
      and the next request from that browser is unauthenticated.
- [ ] The category carries the intended group (**Administration → Kategorien**)
      and holds the services it should (**Administration → Dienste**), and a
      non-member account sees neither the category nor anything in it.
