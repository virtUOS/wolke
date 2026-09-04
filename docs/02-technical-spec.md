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
One documented exception: genuinely device-scoped flags (currently only the one-time PWA
install-hint dismissal, `lib/pwa-install.ts`) live in localStorage — a server pref would hide
the hint on the phone because it was dismissed on the desktop.

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
  primary_role  text not null,          -- a configured role slug (§6); no check constraint: the role set is deployment config
  is_admin      boolean not null default false,   -- derived from group claim at login
  view_mode     text not null default 'auto' check (view_mode in ('list','table','auto')),
  theme         text not null default 'system'   check (theme in ('light','dark','system')),
  locale        text not null default 'auto'     check (locale in ('auto','de','en')),  -- 'auto' = detect from browser, else pinned

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
  tag           text,                    -- NULL | 'beta' | 'wartung' (status label)
  keywords      text[] not null default '{}',  -- search aliases; flat, language-agnostic
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
  role        text not null,             -- a configured role slug (§6)
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
  target      text not null default 'service',  -- 'service' (launch) | 'documentation'
  clicked_at  timestamptz not null default now()
);
-- Rollup for fast "frequently used" + cheap metric reads.
create table usage_daily (
  day         date not null,
  service_id  uuid not null,
  user_role   text not null,
  target      text not null default 'service',
  clicks      bigint not null default 0,
  primary key (day, service_id, user_role, target)
);

-- Announcements accumulate as history: rows are retained, not destroyed on
-- replace. "One ACTIVE notice at a time" is enforced in the service layer —
-- creating a new announcement retires the current active one (stamps ends_at =
-- now()). A retention sweep (announcement_retention_days, default 60) purges
-- expired rows past the window. (Part of the v1 baseline, migrations/00001_init.sql.)
create table announcements (
  id          uuid primary key default gen_random_uuid(),
  title       jsonb not null,
  body        jsonb not null,
  severity    text not null check (severity in ('info','warning','critical')),
  audience    text not null default 'all',   -- 'all' or a configured role slug (§6)
  starts_at   timestamptz,
  ends_at     timestamptz,
  dismissible boolean not null default true,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now()
);

-- Per-user dismissals: a closed banner stays gone across reloads/devices. Keyed
-- by announcement id, so a re-created announcement (new id) re-shows. Cascades.
create table announcement_dismissals (
  user_id         uuid not null references users(id) on delete cascade,
  announcement_id uuid not null references announcements(id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (user_id, announcement_id)
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

**Why no role check constraints.** The role set comes from the deployment's
claim mapping (§6), and a config-time set cannot be a schema-time constraint — a two-role or
six-role deployment would fail its own writes. Role validation lives in `/internal/service`
instead, shared by the HTTP handlers and the MCP tools (CLAUDE.md rule 3). Rows written under a
role a later configuration dropped degrade rather than break:

- `users.primary_role` outside the set reads as `oidc.role.default`, and heals at that user's
  next login (roles re-resolve every login).
- `role_defaults` rows for an unknown role are invisible to reads and are purged the next time an
  admin saves any role's list (the purge is audited).
- an announcement whose `audience` is an unknown role reaches nobody, but stays listed with
  `audience_unknown` set so it can be fixed. The flag is computed in the announcement read model
  (`internal/announce`), so the admin API and the public catalog MCP report it identically.

`click_events.user_role` and `usage_daily.user_role` were always free text — they are historical
records, and history keeps the role it was recorded under.

Indexes worth having from day one: `services(is_active)`, a trigram/GIN index on
`services.name` and `services.description` for search, `click_events(user_id, clicked_at)`,
`favorites(user_id, sort)`.

## 5. Search
Start with **PostgreSQL full-text + `pg_trgm`** (fuzzy/prefix over name + description + category
labels + per-service `keywords`). It is more than enough for a few hundred services and a few
thousand users, and it adds zero infrastructure. Only reach for a dedicated search engine if the
catalog grows unexpectedly large or you need cross-field ranking you can't express in SQL —
unlikely here.

`keywords` are admin-configured search aliases — a flat, language-agnostic `text[]` per service
(admins mix German and English terms). They bridge vocabulary gaps the literal text can't (e.g.
`video conference` → BigBlueButton). Matched in SQL via `array_to_string(keywords,' ') ilike …`
alongside the other fields; **search-only**, never exposed via `/api/catalog`. No GIN index on
the joined keywords yet: `array_to_string`/array-to-text casts aren't `IMMUTABLE`, and the catalog
is small enough that the predicate is cheap — revisit with an immutable-wrapper index only if the
scale trigger (§9) is hit. Search runs server-side at `/api/search` (debounced in the SPA) and is
the single search path — there is no client-side fallback matcher.

**Zero-result insights.** Each search appends a row to `search_events (query_norm, result_count,
created_at)` — best-effort, so a logging failure never breaks or slows the response. `query_norm`
is the lowercased/whitespace-collapsed/length-capped query; **no user id is stored** (aggregate-only,
privacy by construction). Queries shorter than 3 characters aren't logged, keeping mid-typing
fragments out of the worklist. The read path (clamp window/size, aggregate, map) lives once in
`service.ListSearchInsights`; both `GET /api/admin/search-insights` (admin-only) and the MCP
`search.insights` tool are thin wrappers over it (CLAUDE.md rule 3). It groups zero-result queries
by frequency over a window (default 30 days, a partial index on `result_count = 0` keeps it cheap).
Retention is bounded by a background pruner (`service.PruneSearchEvents` on a daily ticker in
`cmd/server`, 180-day window) — the events are telemetry, not audit data. The insights drive the
keyword worklist — see docs/01 §4.6.

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

**Logout — both directions**
- *RP-initiated* (the wolke logout button): the server deletes the session row, clears the cookie,
  and redirects to the discovered `end_session_endpoint` (with `client_id` +
  `post_logout_redirect_uri`) so the IdP session ends too.
- *IdP-initiated* (**OIDC Back-Channel Logout 1.0**): logging out at the SSO must also end the
  wolke session (shared/pool computers). At login the `sid` claim of the verified ID token is
  stored on the session row (`sessions.oidc_sid`, NULL when the IdP sends none). The IdP POSTs a
  signed logout token to `POST /auth/backchannel-logout` (unauthenticated, server-to-server,
  responses `Cache-Control: no-store`; exempt from the shared write rate limit — all IdP
  notifications come from one IP — and throttled by its own generous per-IP limit instead).
  The token is validated per spec §2.4–2.6 — JWKS
  signature, `iss`, `aud`, `iat` freshness, `exp` (required per the final spec), the
  `http://schemas.openid.net/event/backchannel-logout` events member, **`nonce` must be absent**,
  `sid` or `sub` present, `jti` replay refused (in-process TTL cache; multi-instance would move
  this to shared storage, §9). Revocation: `sid` → delete the sessions with that `oidc_sid`;
  `sub` only → delete all sessions of that user. The endpoint answers `200` even when nothing
  matched (an expired session is a successful logout; anything else is a live-sid oracle) and
  `400` problem+json for invalid tokens. Accepted logouts are logged via slog (issuer, hashed
  sid/sub, sessions ended) — a security event stream, not an `audit_log` write. The endpoint is
  provider-agnostic and always registered; a deployment enables the feature purely by
  registering the URL at its IdP (see `docs/oidc-keycloak.md`). Front-channel logout is out of
  scope (third-party-cookie dependent).

**Configurable claim mapping (no rebuild to re-deploy elsewhere).** Every deployment differs in how
it represents roles and admins, so the mapping is data, supplied via config (env or a mounted
`auth.yaml`), not code:

```yaml
oidc:
  issuer_url:    https://idp.example.edu/realms/main   # discovery does the rest
  client_id:     uos-wolke
  client_secret: ${OIDC_CLIENT_SECRET}
  scopes: [openid, profile, email]
  # which ID-token / userinfo claim carries affiliation, and how its values map to roles.
  # This block also DEFINES the role set (see "The role set is the mapping" below).
  role:
    claim: eduPersonAffiliation        # e.g. could be 'groups', 'realm_access.roles', a custom claim
    values:                            # claim value -> role slug
      student:  student
      employee: staff
    precedence: [staff, student]       # if several match, pick the first
    default: student                   # if none match
    labels:                            # optional display names; default = the capitalized slug
      student: { de: "Studierende", en: "Students" }
      staff:   { de: "Mitarbeitende", en: "Staff" }
  # how to detect a dashboard admin
  admin:
    claim: groups                      # claim to inspect (supports nested path, e.g. realm_access.roles)
    match: dashboard-admins            # value that grants admin
```

**The role set is the mapping.** The configured roles are the distinct slugs in
`role.values` ∪ `role.precedence` ∪ `{role.default}` — there is no second list to keep in sync, and
nothing in the code knows a role name. The example above is the UOS launch deployment, whose IdM
distinguishes only students from employees; the bundled defaults ship a three-role example instead.
Rules:

- **Slugs** must match `[a-z0-9-]{1,32}`; `all` is reserved (it is the announcement audience meaning
  everyone). A violation fails startup — a role slug travels in URLs (`/api/admin/role-defaults/{role}`)
  and in the `announcements.audience` column.
- **Labels** are optional; a role with none renders as its capitalized slug, in both languages.
- **The `role:` block is all-or-nothing.** A mounted config file that supplies it replaces the
  bundled example wholesale (claim, values, precedence, default, labels) rather than merging with
  it — otherwise a two-role deployment would silently inherit a third role from the example that
  no claim value can produce. Supply the whole block, or none of it.
- **Above five roles** the server logs a WARN once at startup and keeps going: the per-role screens
  (default-view editor, audience picker) are designed for a handful.
- The set is served to the SPA at `GET /api/roles` in precedence order, and it is what every
  role-shaped write is validated against (§4).

The resolver reads these at startup; swapping IdP, claim names, or the number of roles is a config
change. Ship sensible defaults plus this documented example so a new adopter is productive quickly.

**Sessions:** start with a Postgres-backed session table (or signed encrypted cookie if you prefer
stateless). Move to Redis only when you run multiple instances (see §9).

**Authorization**
- Every API route requires a valid session.
- Admin routes and all write paths additionally require `is_admin`.
- `is_admin` is re-derived from the configured admin claim **on every login**, so revoking the
  group/role at the IdP revokes admin access at next login. (For instant revocation, also re-check
  on a short session refresh.)

> **UOS deployment:** the IdM can only distinguish students from employees, so the launch
> configuration is the two-role mapping shown above (`student`, `employee → staff`). The exact
> affiliation claim name and the admin group value are still to be confirmed against the IdM.
> (These are config, not code, so other institutions adapt the hub by editing this block.)

## 7. Metrics — Prometheus

Expose `/metrics` on the app's own listener. **Do not expose it publicly** — protection is by topology: Caddy 404s `/metrics` at the public edge, and the app port stays on the internal network where Prometheus scrapes it directly. `METRICS_TOKEN` adds an optional bearer check for scrape paths that cross a trust boundary; it is unset by default. See README → "Metrics & monitoring".

Core series (prefix `wolke_`; aggregate labels only):
```
wolke_service_clicks_total{service="MyShare", role="student", target="service|documentation"}  # counter
wolke_active_sessions                                           # gauge
wolke_http_request_duration_seconds{route,method,code}          # histogram
wolke_catalog_services{state="active|inactive"}                 # gauge
wolke_announcements_active{severity}                            # gauge
```
`wolke_service_clicks_total` is the usage-by-role requirement. It is fed from the same click
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

**Public catalog MCP server (`/cmd/catalog-mcp`).** A separate read-only server that answers
end-user questions about services ("which tool do I use for collaborative writing?", "what's in
maintenance?"). It requires no identity — the data is the public catalog every member already
sees — and has no write path at all (its `/internal/readmcp` package never imports the admin use
cases, so least privilege is a compile-time guarantee). It reads through the same catalog
snapshot cache as `/api/catalog`, so it never returns soft-deleted services. Tools: `service.list`
(with `category`/`status` filters), `service.get`, `service.search`, `service.list_in_maintenance`,
`category.list`, and `announcements.list` (active announcements across all audiences). Harden a
deployment further by pointing its `DATABASE_URL` at a `SELECT`-only Postgres role.

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
  (URL format, icon allowlist, at least one category, keyword limits — trimmed, de-duped
  case-insensitively, ≤32 per service and ≤50 chars each, etc.).
- **Errors:** API returns problem+json with a stable code + human message; the SPA renders
  empty/error/loading states explicitly (no silent failures).
- **Security headers:** strict CSP (the SPA is same-origin, so this is straightforward),
  HSTS, `SameSite` cookies, CSRF protection on state-changing requests (double-submit token
  or `SameSite=Strict` + custom header check). The one sanctioned CSP exception: when the
  embedded assistant widget is configured (`branding.assistant_widget_url`), its origin is
  appended to `script-src` (loads the widget bundle) and `connect-src` (the SSE chat stream) —
  no other directive is widened.
- **Rate limiting:** modest per-session limit on writes and search.
- **i18n:** server stores localized fields as JSONB (`{de,en}`) and returns *both* languages; the
  SPA picks the active one client-side. Ship `de`, keep `en` wired. The active UI language is
  `users.locale`: `auto` (default) detects it from the browser's `Accept-Language` order, falling
  back to `branding.default_locale`; `de`/`en` pin it. Users switch via the account menu and the
  choice persists server-side (no `Accept-Language` negotiation on the API — content is bilingual).
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

**Scalar knobs (env-overridable).** Besides the auth/DB/branding settings, `ANNOUNCEMENT_RETENTION_DAYS`
(`announcement_retention_days`, default `60`) controls how long an expired announcement is kept in the
history before being purged permanently, measured from `starts_at`; `0` disables purging (keep forever).

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
  imprint_url: "https://www.uni-osnabrueck.de/impressum/"   # legal footer links
  privacy_url: "https://www.uni-osnabrueck.de/datenschutz/" # (empty hides the link)
  feedback_url: ""  # right-aligned footer feedback link (env FEEDBACK_URL): URL or email/mailto:
  bot_url:  ""   # top-bar chatbot button (env BOT_URL); empty hides it
  help_url: ""   # top-bar help button (env HELP_URL): an http(s) URL or a phone/tel: number
  # Embedded assistant chat widget (launcher mode), e.g. eule (github.com/virtUOS/eule).
  # Active only when BOTH are set; supersedes the bot_url top-bar link. The widget URL's
  # origin doubles as the gateway base URL and is CSP-allowlisted (script-src/connect-src).
  # The dashboard's own origin must be in the bot's embedding allowed_origins (CORS).
  assistant_widget_url: ""  # env ASSISTANT_WIDGET_URL; absolute http(s) URL of the bundle
  assistant_bot_id: ""      # env ASSISTANT_BOT_ID
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

### 11.1 PWA (installable web app)

The app is an installable PWA. Like the rest of branding, this stays white-label:

- **Manifest** is served at `GET /manifest.webmanifest`, built from the same `branding` config
  (`name`/`short_name` ← `product_name`, `theme_color`/`background_color` ← the theme), so a fork's
  install name and colors follow its `branding.yaml` — no rebuild.
- **Icons** live in the branding dir (`/branding/icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png`, `apple-touch-icon.png`) and are overridden by mounting replacements,
  exactly like the logo. Defaults ship with the bundled placeholder mark.
- **Service worker** (Workbox via `vite-plugin-pwa`) precaches only the static shell. It is
  deliberately **auth-safe**: `/api`, `/auth`, `/branding`, and `/metrics` are never cached and
  never answered from the shell (a `navigateFallback` denylist), so per-user/role-aware data can't
  leak on a shared device and the OIDC redirect flow is untouched. The app needs a connection to do
  anything beyond the shell, so there is no offline catalog — just an installable, standalone
  window. `sw.js` is served `Cache-Control: no-cache` so deploys land.
- **Updates are prompted, never silent** (`registerType: 'prompt'`, issue #42). A new deploy's
  worker installs and then *waits*; the app shows a small, polite `role="status"` notice — "Neue
  Version verfügbar." + a Reload button — and only that click activates the waiting worker and
  reloads. Nothing reloads on its own: admin forms exist, and an unrequested reload eats input. A
  dismissal lasts for the current page load only; nothing is persisted (the next load already runs
  the new version), and a later update re-shows the notice — including a later update after a
  dismissal in the same long-lived tab (the notice counts the reports it has had, rather than
  reading a flag that is already set).
- **The Reload click always acts** (issue #120). `vite-plugin-pwa` only reloads from a
  `controllerchange`, and a desktop tab is regularly *uncontrolled* — the first load after the
  worker registers, and any hard reload — so on desktop the button could visibly do nothing at
  all. Applying an update therefore goes through `applyUpdate` (`web-ui/src/lib/pwa-update.ts`):
  message the waiting worker to skip waiting, and navigate ourselves after 1.5s if the worker's
  own reload hasn't already taken the page away. The button is disabled while that is in flight, so
  a second click can't race it. `clientsClaim` was evaluated as the alternative and **rejected**: it
  changes nothing about the auth-safe caching rules above, but it buys nothing either (the explicit
  reload is served by the active worker regardless) while making a page that deliberately loaded
  without a worker start fetching lazy chunks through a worker that precaches a different build.
- **Open tabs learn about deploys.** A page that is never navigated would otherwise run a
  superseded bundle forever, which is exactly the case that breaks iterating in production. So the
  registration is re-checked (`registration.update()`) **every 60 minutes** — a constant, not a
  knob — and **whenever the document becomes visible again**, which is the installed-PWA "phone
  unlocks, app resumes" case. A failed check (offline, server restarting) is ignored; the next
  interval or resume retries.
- The notice component (`web-ui/src/components/UpdateNotice.tsx`) also shows on a
  `wolke:sw-need-refresh` window CustomEvent. That is the documented seam the e2e suite triggers —
  Playwright cannot build a second worker version against one embedded binary — and it is ordinary
  production code: with no worker waiting, its Reload falls back to a plain navigation.

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
GET    /api/roles                  → the configured roles [{slug, label{de,en}}], precedence order
GET    /api/catalog                → active services + categories (cache-served)
GET    /api/catalog/defaults       → role-ordered default view for the current user
GET    /api/search?q=              → grouped search results

# personalization
PATCH  /api/me/prefs               → theme, view_mode, locale
GET    /api/favorites              → the user's favorited services
POST   /api/favorites/items        → add a service to favorites {service_id}
DELETE /api/favorites/items        → remove a service from favorites {service_id}
GET    /api/usage/frequent         → the user's frequently-used services

# events
POST   /api/events/click           → record a launch click {service_id}

# announcements
GET    /api/announcements          → active, scoped to the user's role, minus the user's dismissals
POST   /api/announcements/:id/dismiss → dismiss for the current user (persists; not for critical)

# admin 🔒
GET    /api/admin/services         → full catalog incl. inactive
POST   /api/admin/services         🔒 create
PATCH  /api/admin/services/:id     🔒 edit
DELETE /api/admin/services/:id     🔒 soft delete
PUT    /api/admin/role-defaults/:role 🔒 set the ordered default view
POST   /api/admin/categories       🔒 manage categories
POST   /api/admin/announcements    🔒 create (rejected if one already exists — singleton)
PATCH  /api/admin/announcements/:id 🔒 edit/expire
DELETE /api/admin/announcements/:id 🔒 remove (hard delete; dismissals cascade)
GET    /api/admin/audit            🔒 read audit log

# ops (scrape-protected, not public)
GET    /metrics                    → Prometheus
GET    /healthz  /readyz           → liveness / readiness
```
