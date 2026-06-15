# 02 — Technical Specification

## 1. Guiding constraint

> "As simple as pragmatically possible." Usability and simplicity are the goals.

That pushes toward **one language per layer, one database, one deployable artifact, and
boring, well-supported libraries.** Every choice below is justified against that.

## 2. Stack

### Backend — Go modular monolith
| Concern | Choice | Why |
|---------|--------|-----|
| HTTP | `net/http` + **chi** router | Stdlib-native, tiny, middleware-friendly. (Plain `net/http` 1.22 routing is also fine; chi just reads nicer.) |
| DB | **PostgreSQL** | One relational store covers catalog, users, favorites, events, announcements, audit. |
| DB access | **pgx** + **sqlc** | Type-safe queries generated from SQL. No heavy ORM; you write SQL, get Go funcs. |
| Migrations | **goose** (or golang-migrate) | Versioned, checked into the repo. |
| Auth | **coreos/go-oidc** + `golang.org/x/oauth2` | Provider-agnostic OIDC client (uses discovery). Works with Keycloak, Authentik, Zitadel, Auth0, Entra, etc. — not Keycloak-specific. |
| Metrics | **prometheus/client_golang** | Native `/metrics`. |
| Logging | stdlib **log/slog** (JSON) | Structured logs, no dependency. |
| Config | env vars (12-factor), parsed with `envconfig` or stdlib | Easy to run in containers. |
| MCP | **official MCP Go SDK** or `mark3labs/mcp-go` | Admin tools server (§8). Confirm current SDK at the MCP docs. |

Structure (a monolith with clear internal packages — not microservices):

```
/cmd
  /server        # main: HTTP API + embedded SPA
  /mcp           # main: admin MCP server (shares /internal/service)
/internal
  /auth          # OIDC, sessions, role/admin resolution
  /catalog       # services, categories, search
  /favorites     # the user's flat favorites set
  /usage         # click ingestion, "frequently used", rollups
  /announce      # announcements
  /admin         # write paths, validation, audit
  /service       # the use-case layer the HTTP and MCP entrypoints both call
  /store         # sqlc-generated queries + pgx pool
  /cache         # in-process TTL cache
  /metrics       # prometheus collectors
  /web           # embed.FS of the built SPA + static handler
/migrations
/web-ui          # the React app (built into /internal/web at compile time)
```

The key discipline: **HTTP handlers and MCP tools are thin; both call `/internal/service`.**
That's how the form and the MCP server stay behaviorally identical.

### Frontend — React SPA, embedded
| Concern | Choice | Why |
|---------|--------|-----|
| Framework | **React 18 + TypeScript + Vite** | Fast dev, mainstream, pairs with Claude Design. |
| Styling | **Tailwind CSS** + **shadcn/ui** (Radix) | Accessible primitives (dialog, dropdown, toggle) you don't hand-roll. |
| Icons | **lucide-react** | As specified. |
| Server state | **TanStack Query** | Caching, refetch, loading/empty/error states for free. |
| Routing | **React Router** (or TanStack Router) | Tabs and admin routes. |
| Local UI state | React state only | Theme, view-mode, expand state. No Redux. |

**No browser storage of tokens.** Theme/view-mode preferences persist server-side via the
user-prefs API (so they follow the user across devices); a cookie mirror is fine for first paint.

### Why not the alternatives (so the decision is on record)
- **HTMX + Go templates (templ):** genuinely simpler — one codebase, superb caching, less JS.
  Rejected as the *primary* recommendation only because you explicitly want **Claude Design**
  polish and a rich tile/drag/dialog feel; that workflow targets React components. If the design
  ambition were lower, HTMX would be the leaner pick. Keep it in your back pocket.
- **Next.js / full SSR React:** more moving parts (Node runtime in prod) than the job needs.
  A static SPA embedded in the Go binary is simpler to ship and cache.
- **GraphQL:** the data shape is simple and read-heavy; REST + TanStack Query is less ceremony.

### One artifact
Vite builds to static assets → embedded via `go:embed` into `/internal/web` → the Go binary
serves both the JSON API and the SPA. Output: a **single container image**, one process to run.

## 3. Architecture overview

Runtime topology is **Caddy (reverse proxy, TLS) → app → Postgres**, all via Docker Compose in
production (see doc 04 §4). Caddy terminates TLS and forwards to the app, so the app trusts
`X-Forwarded-*` from Caddy only and is told its public URL via config (§10). Local development
runs the app and Vite dev server directly — no Docker, no proxy — against a local Postgres.

```
 Browser ──TLS──► Caddy (reverse proxy, TLS, optional rate-limit/headers)
                    │  (X-Forwarded-Proto/Host/For)
                    ▼
 SPA ◄──────────  Go server ──────────► PostgreSQL
       cookie       │  ▲   (BFF: OIDC code flow,    │
                    │  │    session, API, /metrics) │
                    │  └── in-process catalog cache ─┘
                    │
                    ├── OIDC discovery ──► IdP (Keycloak / Authentik / Zitadel / …)
                    └── /metrics ──► Prometheus ──► Grafana

 Admin's chat client ──► Admin MCP server ──► /internal/service ──► PostgreSQL
                          (preview → confirm)        (shared use-case layer + audit)
```

## 4. Data model (PostgreSQL)

Illustrative DDL — names final-ish, types indicative.

```sql
-- Users: a thin local mirror of the OIDC subject (we don't store passwords).
create table users (
  id            uuid primary key default gen_random_uuid(),
  oidc_sub      text unique not null,
  display_name  text not null,
  email         text,
  primary_role  text not null check (primary_role in ('student','teacher','staff')),
  is_admin      boolean not null default false,   -- derived from group claim at login
  view_mode     text not null default 'auto' check (view_mode in ('list','table','auto')),
  theme         text not null default 'system'   check (theme in ('light','dark','system')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table categories (
  id     uuid primary key default gen_random_uuid(),
  slug   text unique not null,           -- 'teaching', 'ai-tools', ...
  label  jsonb not null,                 -- {"de":"Lehre","en":"Teaching"}
  sort   int not null default 0
);

create table services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   jsonb not null,          -- short, {"de":..,"en":..}
  service_url   text,                    -- NULL => documentation-only entry
  doc_url       text,
  icon          text not null,           -- a lucide icon name, validated against an allowlist
  is_active     boolean not null default true,   -- soft delete = false
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table service_categories (      -- many-to-many
  service_id  uuid references services(id) on delete cascade,
  category_id uuid references categories(id) on delete restrict,
  primary key (service_id, category_id)
);

-- Admin-curated default ordering shown to each role on first visit.
create table role_defaults (
  role        text not null check (role in ('student','teacher','staff')),
  service_id  uuid references services(id) on delete cascade,
  sort        int not null default 0,
  primary key (role, service_id)
);

-- Favorites: a flat per-user set of services (no named lists — see concept §4.4).
create table favorites (
  user_id    uuid references users(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, service_id)
);

-- Click events feed "frequently used" + aggregate metrics.
create table click_events (
  id          bigserial primary key,
  user_id     uuid references users(id) on delete set null,
  service_id  uuid references services(id) on delete set null,
  user_role   text not null,
  clicked_at  timestamptz not null default now()
);
-- Rollup for fast "frequently used" + cheap metric reads.
create table usage_daily (
  day         date not null,
  service_id  uuid not null,
  user_role   text not null,
  clicks      bigint not null default 0,
  primary key (day, service_id, user_role)
);

create table announcements (
  id          uuid primary key default gen_random_uuid(),
  title       jsonb not null,
  body        jsonb not null,
  severity    text not null check (severity in ('info','warning','critical')),
  audience    text not null default 'all' check (audience in ('all','student','teacher','staff')),
  starts_at   timestamptz,
  ends_at     timestamptz,
  dismissible boolean not null default true,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now()
);

-- Every write via form OR MCP lands here.
create table audit_log (
  id          bigserial primary key,
  actor_id    uuid references users(id),
  actor_kind  text not null,            -- 'form' | 'mcp'
  action      text not null,            -- 'service.create', 'service.delete', ...
  target_id   uuid,
  diff        jsonb,                    -- before/after
  created_at  timestamptz not null default now()
);
```

Indexes worth having from day one: `services(is_active)`, a trigram/GIN index on
`services.name` and `services.description` for search, `click_events(user_id, clicked_at)`,
`favorites(user_id, sort)`.

## 5. Search
Start with **PostgreSQL full-text + `pg_trgm`** (fuzzy/prefix over name + description + category
labels). It is more than enough for a few hundred services and a few thousand users, and it
adds zero infrastructure. Only reach for a dedicated search engine if the catalog grows
unexpectedly large or you need cross-field ranking you can't express in SQL — unlikely here.

## 6. Auth — generic OIDC via the BFF pattern

The SPA must never hold tokens. The Go server is the confidential client. **The provider is not
hardcoded** — the hub speaks standard OIDC and uses **discovery** (`.well-known/openid-configuration`),
so it works with Keycloak, Authentik, Zitadel, Auth0, Entra ID, and others. This is a hard
requirement for open-source reuse: nothing in the code may assume Keycloak specifically.

**Login flow**
1. Unauthenticated request → server redirects to the configured IdP (authorization code + PKCE).
2. IdP returns to `/auth/callback`; server exchanges the code, validates the ID token against the
   discovered JWKS.
3. Server maps claims → `primary_role` and `is_admin` using the **configurable claim mapping** below.
4. Server upserts the `users` row and creates a **server-side session**; sets a `Secure`,
   `HttpOnly`, `SameSite=Lax` cookie. The SPA only ever sees the cookie.
5. API calls are authorized from the session. Logout clears the session and uses the discovered
   `end_session_endpoint` if present.

**Configurable claim mapping (no rebuild to re-deploy elsewhere).** Every deployment differs in how
it represents roles and admins, so the mapping is data, supplied via config (env or a mounted
`auth.yaml`), not code:

```yaml
oidc:
  issuer_url:    https://idp.example.edu/realms/main   # discovery does the rest
  client_id:     uos-wolke
  client_secret: ${OIDC_CLIENT_SECRET}
  scopes: [openid, profile, email]
  # which ID-token / userinfo claim carries affiliation, and how its values map to our 3 roles
  role:
    claim: eduPersonAffiliation        # e.g. could be 'groups', 'realm_access.roles', a custom claim
    values:                            # claim value -> internal role
      faculty: teacher
      employee: staff
      member:  staff
      student: student
    precedence: [teacher, staff, student]   # if several match, pick the first
    default: student                          # if none match
  # how to detect a dashboard admin
  admin:
    claim: groups                      # claim to inspect (supports nested path, e.g. realm_access.roles)
    match: dashboard-admins            # value that grants admin
```

The resolver reads these at startup; swapping IdP or claim names is a config change. Ship sensible
defaults plus this documented example so a new adopter is productive quickly.

**Sessions:** start with a Postgres-backed session table (or signed encrypted cookie if you prefer
stateless). Move to Redis only when you run multiple instances (see §9).

**Authorization**
- Every API route requires a valid session.
- Admin routes and all write paths additionally require `is_admin`.
- `is_admin` is re-derived from the configured admin claim **on every login**, so revoking the
  group/role at the IdP revokes admin access at next login. (For instant revocation, also re-check
  on a short session refresh.)

> **Confirm for the UOS deployment:** the actual affiliation claim + values and the admin
> group/role value, then fill the mapping above. (These are now config, not code, so other
> institutions adapt the hub by editing this block.)

## 7. Metrics — Prometheus

Expose `/metrics` (scrape-protected: internal network or bearer/mTLS — do not expose publicly).

Core series:
```
uos_service_clicks_total{service="MyShare", role="student"}   # counter
uos_active_sessions                                            # gauge
uos_http_request_duration_seconds{route,method,code}          # histogram
uos_catalog_services{state="active|inactive"}                 # gauge
uos_announcements_active{severity}                             # gauge
```
`uos_service_clicks_total` is the usage-by-role requirement. It is fed from the same click
ingestion that powers "frequently used", incremented in-process and reconciled against
`usage_daily` so a restart doesn't lose history. Ship a Grafana dashboard JSON alongside
(doc 04 §maintenance). **Exported labels are aggregate only — never a user identifier.**

## 8. Admin MCP server

A second binary (`/cmd/mcp`) that exposes admin operations as MCP **tools**, so an admin can
manage the catalog from a chat client. It links the same `/internal/service` layer as the API,
so validation, soft-delete, and audit logging are identical.

**Tools (read freely; writes are staged):**
| Tool | Effect |
|------|--------|
| `service.list` / `service.get` | Read the catalog. |
| `category.list` | Read categories. |
| `service.propose_create` | Validate input, return a **preview** (rendered tile + diff) and a `change_token`. **No write.** |
| `service.propose_update` | Same, for edits. |
| `service.propose_delete` | Same, for soft delete. |
| `change.confirm` | Takes a `change_token`, performs the staged write, writes audit. |
| `change.discard` | Drops a staged change. |
| `announcement.propose_*` / `change.confirm` | Same pattern for announcements. |

**The confirmation contract (the safety requirement):**
- `propose_*` writes nothing. It validates, computes the before/after diff, stores the staged
  change with a short-lived `change_token`, and returns a human-readable preview.
- The assistant shows the preview to the admin and asks for explicit confirmation.
- Only `change.confirm` with a valid, unexpired token mutates the database.
- Tokens are single-use and expire (e.g. 10 min). Every confirmed change is audit-logged with
  `actor_kind='mcp'`.

**Auth for MCP:** the MCP server must know *which admin* is acting. Bind it to a Keycloak
service/admin identity and require the operator to be in the admin group — never run it
unauthenticated. The exact transport (stdio for a local Claude Desktop/Code client, or an
authenticated HTTP/SSE transport for a hosted internal tool) is the **open decision in
concept §8.10**; design the tool layer transport-agnostic so either works.

> v2 idea, designed-for-not-built: a *separate read-only* MCP server that answers end-user
> questions about services ("which tool do I use for collaborative writing?"). It would expose
> only `service.list/get/search` and never writes — keep that boundary clean.

## 9. Caching & scale (2–3k concurrent peak)

The workload is **read-heavy and the catalog is near-static between admin edits.**

- **Catalog cache:** load active services + categories into an in-process TTL cache
  (`RWMutex`-guarded map or `golang-lru`), invalidated on any admin write. Catalog reads —
  the bulk of traffic — never touch the DB. A single Go instance serves thousands of concurrent
  cached reads comfortably.
- **Per-user data** (favorites, prefs, frequently-used) is small and read via indexed queries;
  cache per-request if needed.
- **Click writes** are append-only and can be buffered/batched, then rolled up into
  `usage_daily` on a schedule.

**When to add Redis:** only if you run **more than one instance** (for HA or rolling deploys).
Then move sessions and the catalog-invalidation signal to Redis so instances stay consistent.
For a single instance, **Redis is unnecessary complexity** — leave it out.

Rule of thumb: start single-instance + Postgres. Reach for Redis + multi-instance behind a load
balancer only when an HA requirement (not raw load) forces it.

## 10. Cross-cutting

- **Validation:** central, in `/internal/service`, so form and MCP enforce the same rules
  (URL format, icon allowlist, at least one category, etc.).
- **Errors:** API returns problem+json with a stable code + human message; the SPA renders
  empty/error/loading states explicitly (no silent failures).
- **Security headers:** strict CSP (the SPA is same-origin, so this is straightforward),
  HSTS, `SameSite` cookies, CSRF protection on state-changing requests (double-submit token
  or `SameSite=Strict` + custom header check).
- **Rate limiting:** modest per-session limit on writes and search.
- **i18n:** server stores localized fields as JSONB (`{de,en}`); SPA uses a lightweight i18n lib.
  Ship `de`, keep `en` wired.
- **Behind a reverse proxy:** the app runs behind Caddy (TLS terminated at the proxy). It must
  read the client protocol/host from `X-Forwarded-Proto`/`X-Forwarded-Host` (trusting them **only**
  from the proxy), and take its own public URL from config (`PUBLIC_URL`) — used to build the OIDC
  `redirect_uri` and to set `Secure` cookies correctly even though TLS terminates upstream. The app
  itself serves plain HTTP inside the Compose network. In local dev (no proxy) it serves directly.

## 11. Configuration & white-labeling (open-source reuse)

The hub is meant to be **forkable and re-brandable without code changes**. Everything
institution-specific is config or mounted assets, never compiled-in.

**Config sources (precedence: env > mounted file > defaults).** Secrets via env; structured maps
(claim mapping, branding) via a small mounted file. All 12-factor, so it drops cleanly into Compose.

**Branding / theme — runtime, no rebuild.** The default theme is UOS (doc 03), but a deployer
overrides it by mounting a `branding.yaml` + asset files; the server exposes them at
`GET /api/branding`, and the SPA applies them as CSS variables on load (logo, product name, and
the token set):

```yaml
branding:
  product_name: "IT Service"
  org_name: "Universität Osnabrück"
  logo_light: /branding/logo-light.svg     # mounted asset paths
  logo_dark:  /branding/logo-dark.svg
  favicon:    /branding/favicon.svg
  theme:
    light: { primary: "#A6093D", primary_hover: "#8A0732", accent: "#F2C879",
             surface: "#F4F4F5", text: "#18181B" }
    dark:  { primary: "#C2355C", primary_hover: "#A6093D", accent: "#F2C879",
             surface: "#1E1E21", text: "#F4F4F5" }
  default_locale: de
```

Because the SPA reads tokens from `/api/branding` at runtime (rather than hardcoding them at build
time), a fork re-skins by editing one file and swapping logo assets — no recompile. The doc 03
palette ships as the bundled default. Keep the variable **names** stable; only values change.

**Other config (env):** `DATABASE_URL`, `PUBLIC_URL`, `SESSION_SECRET`, `OIDC_*` (issuer, client
id/secret, scopes) + the claim-mapping file from §6, `METRICS_TOKEN`, `LOG_LEVEL`. Ship a
`.env.example` and a documented `config.example.yaml` so a new adopter is running in minutes.

## 12. REST API surface (v1)

All routes require a session; `🔒` additionally requires `is_admin`. JSON in/out.

```
# auth (BFF)
GET    /auth/login                 → 302 to the configured IdP
GET    /auth/callback              → set session, 302 to app
POST   /auth/logout                → clear session + IdP end-session (if discovered)

# the dashboard read model
GET    /api/branding               → product name, logo URLs, theme tokens (public; no session)
GET    /api/me                     → user, primary_role, is_admin, prefs
GET    /api/catalog                → active services + categories (cache-served)
GET    /api/catalog/defaults       → role-ordered default view for the current user
GET    /api/search?q=              → grouped search results

# personalization
PATCH  /api/me/prefs               → theme, view_mode
GET    /api/favorites              → the user's favorited services
POST   /api/favorites/items        → add a service to favorites {service_id}
DELETE /api/favorites/items        → remove a service from favorites {service_id}
GET    /api/usage/frequent         → the user's frequently-used services

# events
POST   /api/events/click           → record a launch click {service_id}

# announcements
GET    /api/announcements          → active, scoped to the user's role

# admin 🔒
GET    /api/admin/services         → full catalog incl. inactive
POST   /api/admin/services         🔒 create
PATCH  /api/admin/services/:id     🔒 edit
DELETE /api/admin/services/:id     🔒 soft delete
PUT    /api/admin/role-defaults/:role 🔒 set the ordered default view
POST   /api/admin/categories       🔒 manage categories
POST   /api/admin/announcements    🔒 create
PATCH  /api/admin/announcements/:id 🔒 edit/expire
GET    /api/admin/audit            🔒 read audit log

# ops (scrape-protected, not public)
GET    /metrics                    → Prometheus
GET    /healthz  /readyz           → liveness / readiness
```
