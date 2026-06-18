# Configuring OIDC with Keycloak

wolke authenticates with **generic OIDC** via the BFF pattern — there's no
Keycloak-specific code. It discovers the provider from its issuer URL, runs the
authorization-code flow (PKCE) server-side as a **confidential client**, and
keeps tokens on the server (the browser only ever gets an httpOnly session
cookie). Any compliant IdP works; this guide is the concrete Keycloak recipe.

Two things are worth internalizing before you start, because they cause almost
every misconfiguration:

- **wolke reads every claim it needs from the ID token** (subject, name, email,
  and your role/admin claims). It does **not** call the userinfo endpoint. So any
  Keycloak mapper that carries a role or group claim **must have "Add to ID
  token" enabled** — by default Keycloak only adds those to the *access* token.
- **The claim→role/admin mapping is data, not code.** It lives in `config.yaml`
  (`oidc.role`, `oidc.admin`); env vars only set the connection scalars. Swapping
  IdP or claim names is a config edit + restart, never a recompile.

Throughout, substitute your own values:

| Placeholder | Example |
|---|---|
| Keycloak base URL | `https://id.example.edu` |
| Realm | `uni` |
| wolke public URL (`PUBLIC_URL`) | `https://wolke.example.edu` |

---

## 1. Create the Keycloak client

In the Keycloak admin console, select your realm → **Clients** → **Create client**.

**General settings**
- Client type: **OpenID Connect**
- Client ID: `wolke`  *(this becomes `OIDC_CLIENT_ID`)*

**Capability config**
- **Client authentication: On** — this makes it a *confidential* client with a
  secret, which the BFF flow requires.
- **Authorization: Off**
- Authentication flow: **Standard flow** on (authorization code); everything else
  (Direct access grants, Implicit, Service accounts) **off**.

**Login settings**
- **Valid redirect URIs:** `https://wolke.example.edu/auth/callback`
  — exact match; wolke always derives the redirect from `PUBLIC_URL` + `/auth/callback`.
- **Valid post logout redirect URIs:** `https://wolke.example.edu`
  — wolke sends `PUBLIC_URL` as the `post_logout_redirect_uri` on single sign-out.
- **Web origins:** leave empty. wolke is server-side; the browser never calls
  Keycloak directly, so no CORS origin is needed.

Save, then open the **Credentials** tab and copy the **Client secret** — that's
`OIDC_CLIENT_SECRET`.

---

## 2. Point wolke at Keycloak

These are scalar settings, so set them via environment (they override
`config.yaml`). The issuer URL is the realm URL — Keycloak 17+ has **no** `/auth`
prefix (older versions use `/auth/realms/…`):

```bash
OIDC_ISSUER_URL=https://id.example.edu/realms/uni
OIDC_CLIENT_ID=wolke
OIDC_CLIENT_SECRET=<the secret from the Credentials tab>
# Defaults are fine; profile gives name, email gives email:
OIDC_SCOPES=openid,profile,email

PUBLIC_URL=https://wolke.example.edu   # must match the browser origin exactly
SESSION_SECRET=<openssl rand -base64 32>
```

Sanity-check the issuer before deploying — this exact URL must resolve:

```bash
curl -fsS https://id.example.edu/realms/uni/.well-known/openid-configuration | jq .issuer
# must print "https://id.example.edu/realms/uni" — it has to match OIDC_ISSUER_URL byte-for-byte
```

wolke fills the user's display name from `name` (falling back to
`preferred_username`, then `email`), and email from `email` — the default
`profile`/`email` scopes cover both.

---

## 3. Map Keycloak claims → roles and admin

wolke has exactly three roles (`student`, `teacher`, `staff`) plus an `is_admin`
flag, both re-derived **on every login** (revoke at Keycloak → gone at next
login). You decide which Keycloak claim drives each and how its values map.

The simplest single mechanism is **Keycloak groups**: one `groups` claim feeds
both the role mapping and the admin check.

### 3a. Create groups and emit a `groups` claim

1. **Realm → Groups** → create `students`, `teachers`, `staff`, and
   `dashboard-admins`. Assign users (or wire group membership from your LDAP/IdP
   federation).
2. **Clients → wolke → Client scopes → `wolke-dedicated` → Add mapper → By
   configuration → Group Membership**:
   - **Name:** `groups`
   - **Token Claim Name:** `groups`
   - **Full group path: Off** — so the claim is `dashboard-admins`, not
     `/dashboard-admins` (match the names in `config.yaml` accordingly).
   - **Add to ID token: On** ← the critical setting.
   - Add to access token / userinfo: optional.

### 3b. Map the claim in `config.yaml`

```yaml
oidc:
  scopes: [openid, profile, email]
  role:
    claim: groups            # the Keycloak Group Membership claim
    values:                  # Keycloak group name -> wolke role
      teachers: teacher
      staff: staff
      students: student
    precedence: [teacher, staff, student]   # if a user is in several, first wins
    default: student                          # if none match
  admin:
    claim: groups
    match: dashboard-admins   # membership in this group ⇒ is_admin
```

Restart wolke (`config.yaml` is read at startup). Group membership is
multi-valued — wolke handles single or array claims — and `precedence` resolves
users who land in more than one mapped group.

### Alternative: Keycloak realm roles

If you'd rather drive roles from **realm roles** than groups, wolke reads nested
claims by dot-path, so use Keycloak's built-in `realm_access.roles`:

1. **Realm → Realm roles** → create roles (e.g. `lecturer`, `employee`), assign them.
2. The `realm_access.roles` claim ships in the *access* token by default. To get
   it into the **ID token**: **Client scopes → `roles` → Mappers → "realm roles"**
   → turn **Add to ID token: On**.
3. Map it:
   ```yaml
   role:
     claim: realm_access.roles    # dot-path into the nested claim
     values:
       lecturer: teacher
       employee: staff
     precedence: [teacher, staff, student]
     default: student
   ```

The admin check can use realm roles the same way (`admin.claim: realm_access.roles`,
`match: wolke-admin`), or stay on groups — they're independent.

---

## 4. Verify

1. Browse to `https://wolke.example.edu` → you're redirected to Keycloak, log in,
   and land back on the dashboard.
2. `GET /api/me` (with the session cookie) shows your resolved `primary_role` and
   `is_admin`. An admin also sees the **Administration** entry in the account menu.
3. The server logs one structured line per login: `{"msg":"login","sub":…,"role":…,"admin":…}`.

> The **admin MCP server** identifies its admin by OIDC `sub` (`MCP_ADMIN_SUB`).
> That user must have logged into the web UI at least once so their record exists
> (and `is_admin` is set) — see the README's "Admin MCP server".

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Everyone is `student`, nobody is admin | The role/group claim isn't in the **ID token**. Enable **Add to ID token** on the Group Membership / realm-roles mapper (step 3a). Verify by decoding the ID token at jwt.io — the claim must be present. |
| Admin never granted | `groups` carries full paths (`/dashboard-admins`). Set **Full group path: Off**, or set `admin.match: /dashboard-admins`. |
| `invalid_redirect_uri` at Keycloak | The client's Valid redirect URIs must contain `PUBLIC_URL` + `/auth/callback`, exactly. |
| Login loops / "id_token nonce mismatch" or issuer errors | `OIDC_ISSUER_URL` must equal the `iss` in the token byte-for-byte (mind the `/realms/<realm>` path and `http` vs `https`). Check the discovery URL (step 2). |
| Session cookie not set / immediately logged out | `PUBLIC_URL` must match the browser origin and be `https://…` in production (the `Secure` cookie flag is derived from its scheme). Make sure Caddy/your proxy forwards `X-Forwarded-Proto`. |
| Role/admin change at Keycloak doesn't take effect | They're re-derived per login — the user must log out and back in. |

For the full auth model and the config precedence (env > file > defaults), see
`docs/02-technical-spec.md` §6 and §11.
