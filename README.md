# wolke

A role-aware IT service launcher for universities. Each role — students, staff, whatever the institution's IdP distinguishes — lands on a dashboard pre-arranged for their kind of work — they can search the full service catalog, pin favorites, and stay informed through announcements. Admins curate the catalog and default views through a form UI or an MCP server.

Built as a Go modular monolith with an embedded React/TypeScript SPA, PostgreSQL, and generic OIDC authentication. Designed to be reused: all branding, OIDC claim mapping, and the product name are runtime config — no institution is hardcoded.

---

## Local development

The primary dev loop runs without Docker. You'll need **Go 1.26+**, **Node 24+**, and **Podman** (or Docker — just swap `podman` for `docker` in the Makefile).

```bash
# 1. Copy the environment template and fill in any secrets
cp .env.example .env

# 2. Start a local Postgres 17 container
make db

# 3. Start the mock OIDC identity provider (needed for login)
make idp

# 4. Apply all migrations
make migrate

# 5. (Optional) seed the catalog with example services
make seed

# 6. Install frontend dependencies
make web-install
```

Then run the Go server and the Vite dev server in two separate terminals:

```bash
# Terminal A — Go API on :8080
make run

# Terminal B — Vite on :5173, proxying /api/* to :8080
make web-dev
```

Open **http://localhost:5173** in your browser. The mock IdP lets you log in with any username; set `is_admin: true` in `dev/mock-oidc-config.json` to test admin features.

> **Note:** after any schema change (`migrations/` gets a new file), run `make migrate` before restarting the server.

### End-to-end viewport tests

Layout correctness on real phone widths is a gate, not a polish pass
(CLAUDE.md → "Responsive & viewport discipline"). The Playwright suite drives the
**embedded binary** — the artifact we ship — against the local Postgres and mock
IdP, and runs every covered screen at six fixed resolutions (324×756, 360×800,
390×844, 768×1024, 1280×720, 1920×1080), failing on horizontal overflow, text
under 12px and phone touch targets under 44px.

```bash
make e2e-install   # once: download the Chromium build Playwright drives
make db idp seed   # the suite needs the same stack as `make run`
make e2e           # build the SPA + binary, then run the whole matrix
make e2e-ui        # the same suite in Playwright's interactive UI mode
```

A single project or spec:

```bash
cd web-ui
npx playwright test --project=mobile-324
npx playwright test e2e/dashboard.spec.ts
npx playwright show-report
```

The specs live in `web-ui/e2e/`; `docs/specs/responsive-viewport-testing.md` is
the design, including what the shared assertions check and how to add a screen.
Specs named `issue-<n>-*.spec.ts` reproduce an open layout bug and are annotated
`test.fixme` with a link to it — the PR that fixes the bug removes the annotation.

### Other useful targets

```
make test         Run Go tests with the race detector
make lint         Run golangci-lint
make web-check    Frontend typecheck + lint + tests
make check        Run the full local gate (Go + frontend combined)
make e2e          Playwright viewport suite (see above)
make migrate-down Roll back the last migration
make sqlc         Regenerate type-safe queries from SQL (after editing *.sql)
make build        Build a single binary with the SPA embedded → bin/server
make mcp          Build the admin MCP server → bin/mcp
make clean        Remove build artifacts
```

---

## Deployment (Docker Compose)

The `Dockerfile` builds the SPA (Node) and embeds it — along with the SQL migrations — into a static Go binary, producing **one small distroless image** (~20 MB) that runs as a non-root user with a read-only root filesystem. On every push to `main` (and every `v*` tag) CI publishes it to GHCR at `ghcr.io/<owner>/<repo>`.

**The app applies forward-only migrations itself on startup** (advisory-locked via goose, so rolling-deploy replicas don't race; a no-op when the schema is already current). There's no separate migration image or step — set `AUTO_MIGRATE=false` to opt out and run the goose CLI yourself.

Two compose files ship: **`compose.yaml`** builds from source (staging / a quick end-to-end run), and **`compose.prod.yaml`** pulls the released image (production). Both put Caddy in front as the only exposed surface, keep Postgres on an internal-only network, and harden every service (`no-new-privileges`, `cap_drop: ALL`, read-only roots). Caddy waits on the app's `/readyz` healthcheck before accepting traffic.

### Production — `compose.prod.yaml` (pulls the image)

No source tree or build toolchain on the host. Point it at the published image and a released version, then bring it up:

```bash
export IMAGE_REPO=ghcr.io/<owner>/<repo>     # e.g. ghcr.io/virtuos/wolke
export WOLKE_VERSION=1.4.0                    # a released tag, or a @sha256 digest
docker compose -f compose.prod.yaml up -d     # or: podman-compose -f compose.prod.yaml up -d
```

On startup the app waits for Postgres, applies any pending migrations, then serves.

Everything **fails closed** — these must be set (in a `.env` beside the file, or the environment) or `compose up` aborts: `IMAGE_REPO`, `WOLKE_VERSION`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `PUBLIC_URL`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. Before the first deploy, put the real hostname in the `Caddyfile` (replace `localhost`) and provide a `config.yaml` next to the compose file.

### Staging / end-to-end — `compose.yaml` (builds from source)

```bash
POSTGRES_PASSWORD=$(openssl rand -base64 24) SESSION_SECRET=$(openssl rand -base64 32) \
  docker compose up -d --build
```

Caddy serves HTTPS on :443 (its internal CA for `localhost`; real certificates for a public hostname). Rootless podman can't bind <1024 — set `CADDY_HTTPS_PORT=8443` then. Bring up the mock IdP for a full login flow with `--profile idp`.

### Notes

**Branding and OIDC claim mapping** live in `config.yaml` (copy from `config.example.yaml`). This is the one file you edit to reskin for a different institution — colors, logo paths, product name, and which OIDC claim maps to which role. **The roles themselves come from that mapping**: the distinct slugs in `oidc.role.values` ∪ `precedence` ∪ `{default}` are the role set (optional `labels:` give them display names), so a deployment whose IdP only tells students from employees configures two roles and sees exactly two everywhere — admin editors, default views, announcement audiences. Slugs are `[a-z0-9-]{1,32}` and `all` is reserved; more than five roles works but logs a startup warning, since the per-role admin screens are built for a handful. Supplying the `role:` block in your config file replaces the built-in one whole — set all of it (claim, values, precedence, default, optional labels), not just the keys you want to change. OIDC is provider-agnostic (Keycloak, Authentik, Zitadel, Entra, …); for a step-by-step Keycloak setup see **[docs/oidc-keycloak.md](docs/oidc-keycloak.md)**. wolke also implements **OIDC back-channel logout** — logging out at the IdP ends the wolke session too. Register `PUBLIC_URL` + `/auth/backchannel-logout` as the client's back-channel logout URL at your IdP (with "session required" enabled where offered); that registration is the only knob, the endpoint is always on. `TRUSTED_PROXIES` must cover the proxy's network so `X-Forwarded-For` is trusted (it's preset to the compose `edge` subnet).

**Branding assets** are plain files: mount a directory over the bundled `branding/`
(compose: `- ./branding:/branding:ro,z`). The mount **replaces the bundled set
wholesale — provide all seven files**: `logo-light.svg`, `logo-dark.svg`,
`favicon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
`apple-touch-icon.png` (a missing file 404s; there is no per-file fallback, and the
manifest still advertises the icons, so the PWA install silently degrades). The
logos and favicon are referenced from `config.yaml` (`branding.logo_light` etc.);
the PNGs serve the PWA manifest and the apple-touch link. **These seven names are
served publicly** (unauthenticated, at `/branding/`) — only they are; any other
filename in the directory, and `/branding/` itself, 404 rather than being listed
or served. Keep only these assets in it anyway, never drafts, working files, or
secrets — the allowlist is a floor, not a reason to get careless with the mount.

**PWA updates reach open clients.** The app is an installable PWA whose service worker updates in *prompt* mode: a deploy never reloads anyone's tab by surprise, but every running client — a long-lived desktop tab or the installed app on a phone — checks for a new version hourly and on every resume, then offers an in-app "Neue Version verfügbar. / Reload" notice. So a fix ships to open clients within an hour, or on the next app resume, whichever comes first. See [docs/02 §11.1](docs/02-technical-spec.md).

**Migrations** are forward-only (goose) and applied by the app on startup (see above). Rolling back requires an explicit `make migrate-down` in dev.

---

## Backups

The catalog (services, categories, role defaults) and favorites are the
irreplaceable data — everything else regenerates (`users` from OIDC on next
login) or is disposable (`sessions`, analytics). `compose.prod.yaml` ships an
**opt-in `backup` service** that keeps them safe: a `pg_dump -Fc` of the `wolke`
database, pushed to a **restic** repository (an S3 bucket in the tested setup),
followed by `restic forget --prune`. restic encrypts client-side and
de-duplicates, so a daily full dump costs little more than the delta.

It is deliberately boring: one pinned image (`postgres:17-alpine`, whose
`pg_dump` therefore always matches the server's major version) running
[`deploy/backup/backup.sh`](deploy/backup/backup.sh) — a POSIX shell loop. No
cron daemon, no scheduler, no second datastore.

### Enabling it

Nothing to enable by default: without `--profile backup` the service does not
exist and the stack runs exactly as before. To turn it on, set the variables in
your `.env` (the annotated block is at the bottom of
[`.env.example`](.env.example)) and add the profile:

```bash
# .env
RESTIC_REPOSITORY=s3:https://s3.example.org/wolke-backups
RESTIC_PASSWORD=$(openssl rand -base64 32)   # store this OFF the server
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

```bash
docker compose -f compose.prod.yaml --profile backup up -d
docker compose -f compose.prod.yaml --profile backup logs -f backup
```

The repository is created on first run (`BACKUP_INIT_REPO=false` to do it
yourself). Nothing institution-specific is committed — every value above is
env, and the bucket, endpoint and credentials are yours.

### Knobs and defaults

| Variable | Default | Meaning |
|---|---|---|
| `RESTIC_REPOSITORY` | — | restic repository URL, e.g. `s3:https://host/bucket`. Required |
| `RESTIC_PASSWORD` | — | Encrypts the repository. Required. **Losing it loses every backup** |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | Required for `s3:` repositories |
| `AWS_DEFAULT_REGION` | `us-east-1` | Region; MinIO and most S3-compatibles ignore it |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Seconds between backups (daily) |
| `BACKUP_RUN_ON_START` | `true` | Back up immediately at container start |
| `BACKUP_KEEP_DAILY` | `7` | `restic forget --keep-daily` |
| `BACKUP_KEEP_WEEKLY` | `4` | `restic forget --keep-weekly` |
| `BACKUP_KEEP_MONTHLY` | `6` | `restic forget --keep-monthly` |
| `BACKUP_TAG` | `wolke-db` | Snapshot tag; also scopes the retention policy |
| `BACKUP_INIT_REPO` | `true` | Create the repository on first run |
| `BACKUP_PROBE_TIMEOUT` | `45` | Seconds before the repository is called unreachable |
| `BACKUP_RESTIC_VERSION` | — | Pin the restic Alpine package, e.g. `0.18.1-r7` |

`PGHOST`/`PGUSER`/`PGDATABASE` are fixed to the stack's `postgres` service and
`PGPASSWORD` reuses `POSTGRES_PASSWORD`; there is nothing to set for those.

### It never fails quietly

A backup job that silently stops is worse than none. Every failure path logs at
`ERROR` and exits non-zero, so the container crash-loops under
`restart: unless-stopped` and shows up in `docker compose ps` and your log
alerting. The distinguishable cases, each with its own message:

| Situation | Logged as |
|---|---|
| Enabled but unconfigured | `missing required environment: …` — refuses to start |
| S3 endpoint unreachable | `cannot reach the backup repository: …` |
| Wrong S3 credentials | `the backup repository rejected our credentials: …` |
| Wrong `RESTIC_PASSWORD` | `RESTIC_PASSWORD does not open this repository` — refuses rather than start a second repo |
| Postgres unreachable / wrong password | `pg_dump failed — is postgres reachable …` |
| `pg_dump` produced an empty file | `pg_dump produced an empty file` |

A cycle only logs `backup cycle ok` when `pg_dump`, `restic backup` **and**
`restic forget --prune` all succeeded.

> Because the backup service is enabled by a profile, Compose cannot fail closed
> on its variables the way it does for `SESSION_SECRET` and friends — it
> interpolates the file before it applies profiles, so a `:?` default would
> break stacks that never enable backups. The check therefore lives in
> `backup.sh`, which refuses to start when the configuration is incomplete.

### Networking

The service joins `backend` (to reach Postgres) and a dedicated `egress`
network for the S3 endpoint. It deliberately does **not** join `edge`: that
subnet is what the app trusts for `X-Forwarded-*` headers, and a backup job has
no business being in it. Postgres itself stays internal-only, as before.

`restic` is installed from the Alpine community repository at container start
rather than baked into a second published image — so the container needs
outbound access to the Alpine mirrors at start-up as well as to your S3
endpoint. If it can't reach them it says so and exits (`could not install
restic`); pin `BACKUP_RESTIC_VERSION` if you need a reproducible version.

### Restoring

See the runbook: **[Restore PostgreSQL from backup](docs/runbooks/restore-postgres.md)**.
Backups you have never restored are a hypothesis, not a backup — rehearse it.

---

## Metrics & monitoring

The app exposes Prometheus metrics at `GET /metrics` on its own listener (`:8080`), in the standard Prometheus text format. The endpoint is mounted only when the metrics collector is wired (the default for the server binary).

### What's exposed

All series are prefixed `wolke_` (never an institution name), and labels are **aggregate only — never a user identifier**:

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `wolke_http_request_duration_seconds` | histogram | `route`, `method`, `code` | Request latency. `route` is the matched chi pattern, not the raw path, so cardinality stays bounded |
| `wolke_service_clicks_total` | counter | `service`, `role` | Launch clicks per service and role (the usage-by-role signal) |
| `wolke_active_sessions` | gauge | — | Currently valid server-side sessions |
| `wolke_catalog_services` | gauge | `state` (`active` / `inactive`) | Catalog size by state |
| `wolke_announcements_active` | gauge | `severity` | In-window announcements by severity |

The histogram and click counter update in-process per request; the three gauges are refreshed from the database every 30s by a background worker. Metrics live on a **private registry**, so the endpoint exposes only these series — no default Go/process collectors.

### How it's scraped

Prometheus scrapes the app **directly on the internal network** (e.g. `app:8080/metrics` inside the Compose/cluster network); Grafana visualises it (a starter dashboard lives in `deploy/grafana/`).

### Protecting `/metrics`

`/metrics` must never be publicly reachable — and protection is by **topology**, not the application:

1. **Caddy 404s it at the edge.** The public vhost returns 404 for `/metrics` (see `Caddyfile`), so it is invisible from the internet.
2. **The app port is internal-only.** `:8080` is not published to the host; only Caddy and Prometheus reach it, over the internal network.

In this setup you do **not** need an application-level secret — protecting at the reverse proxy + network boundary is the intended model. So `METRICS_TOKEN` is **optional**:

- **Unset (default):** `/metrics` serves with no auth. Correct when the scrape path stays inside a trusted network.
- **Set:** the endpoint additionally requires `Authorization: Bearer <token>` (constant-time compared). Reach for this only when the scrape path crosses a boundary you don't fully control — a shared/multi-tenant network, or cross-host scraping without mTLS.

> The load-bearing invariant is that the app's `:8080` isn't reachable by untrusted parties. The Caddy 404 only covers the public vhost — it does **not** protect a direct hit on the app port. So if you ever publish `:8080` to the host or a shared LAN, set `METRICS_TOKEN` (or put mTLS in front of the scrape).

---

## HTTP API

All admin endpoints require an authenticated session (login via OIDC) belonging to an admin user. Regular catalog reads are available to any authenticated user.

### Catalog (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/me` | Current user profile and preferences |
| `GET` | `/api/catalog` | All active services and categories |
| `GET` | `/api/catalog/defaults` | Role-ordered default view for the current user |
| `GET` | `/api/search?q=…` | Full-text search across the catalog |
| `GET` | `/api/favorites` | Current user's favorited services |
| `POST` | `/api/favorites/items` | Add a favorite `{ "service_id": "…" }` |
| `DELETE` | `/api/favorites/items` | Remove a favorite `{ "service_id": "…" }` |
| `GET` | `/api/announcements` | Active announcements for the current user |
| `PATCH` | `/api/me/prefs` | Update preferences (theme, view mode, …) |
| `POST` | `/api/events/click` | Record a service launch (fire-and-forget) |

### Admin (admin users only)

Writes happen immediately — no staging step. Every write is audit-logged with `actor_kind = "form"`.

**Services**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/services` | List all services including inactive |
| `POST` | `/api/admin/services` | Create a service |
| `PATCH` | `/api/admin/services/{id}` | Update a service |
| `DELETE` | `/api/admin/services/{id}` | Soft-delete a service |

Service body (create/update):

```json
{
  "name": "VPN",
  "description": {
    "de": "Sicherer Zugang zum Hochschulnetz.",
    "en": "Secure access to the university network."
  },
  "service_url": "https://vpn.example.edu",
  "doc_url": "https://docs.example.edu/vpn",
  "icon": "shield",
  "categories": ["netzwerk"],
  "tag": "wartung"
}
```

`tag` is optional — `"beta"` shows a blue badge, `"wartung"` shows an amber badge on the tile. Omit or set to `""` for no badge.

**Categories, announcements, role defaults**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/categories` | Create a category |
| `GET` | `/api/admin/announcements` | List all announcements |
| `POST` | `/api/admin/announcements` | Create an announcement |
| `PATCH` | `/api/admin/announcements/{id}` | Update an announcement |
| `GET` | `/api/admin/role-defaults/{role}` | Get default service order for a role |
| `PUT` | `/api/admin/role-defaults/{role}` | Replace default order `{ "service_ids": ["…"] }` |
| `GET` | `/api/admin/audit` | Audit log (last 100 entries; `?limit=N` up to 500) |

---

## Admin MCP server

The MCP server gives Claude (or any MCP client) access to the same admin operations as the HTTP API, with one important difference: **writes are staged**. A `propose_*` call validates the change and returns a preview — no data is written. Only `change.confirm` with the returned token actually commits. Tokens expire after 10 minutes and are single-use.

Every confirmed write is audit-logged with `actor_kind = "mcp"`, distinct from form writes.

### Setup

The admin user must have logged into the web UI at least once so their record exists in the database.

```bash
make mcp   # builds bin/mcp
```

Set these environment variables when launching the binary:

```
DATABASE_URL    postgres connection string (same as the app)
MCP_ADMIN_SUB   OIDC subject of the admin user (find it in the audit log or DB)
CONFIG_FILE     optional path to config.yaml
```

For **Claude Desktop**, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wolke-admin": {
      "command": "/path/to/bin/mcp",
      "env": {
        "DATABASE_URL": "postgres://wolke:…@localhost:5432/wolke?sslmode=disable",
        "MCP_ADMIN_SUB": "the-admin-oidc-sub"
      }
    }
  }
}
```

### Available tools

**Reads** (no staging required):

| Tool | Description |
|------|-------------|
| `service.list` | List all services including inactive |
| `service.get` | Get one service by ID |
| `category.list` | List all categories |

**Propose** (validates and stages — no write, returns a `change_token` and before/after preview):

| Tool | Description |
|------|-------------|
| `propose_create` | Stage a new service |
| `propose_update` | Stage an edit to an existing service |
| `propose_delete` | Stage a soft-delete |

**Commit or discard:**

| Tool | Description |
|------|-------------|
| `change.confirm` | Execute the staged change (consumes the token) |
| `change.discard` | Abandon the staged change |

---

## Public catalog MCP server

A second, read-only MCP server that any university member can run — no admin rights, no user identity required. It exposes the same public catalog the web UI shows: which services exist, which are in **maintenance** or **beta**, where their **documentation** lives, plus search and active announcements. It has **no write path at all** (enforced at the package level), and never returns soft-deleted services.

### Setup

It needs only a database connection — set `DATABASE_URL`.

```bash
make catalog-mcp   # builds bin/catalog-mcp
```

For **Claude Desktop**, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wolke-catalog": {
      "command": "/path/to/bin/catalog-mcp",
      "env": {
        "DATABASE_URL": "postgres://wolke:…@localhost:5432/wolke?sslmode=disable"
      }
    }
  }
}
```

> For defense-in-depth, point `DATABASE_URL` at a Postgres role with only `SELECT` grants — the server only ever reads.

### Available tools

| Tool | Description |
|------|-------------|
| `service.list` | Active services; optional `category` (slug) and `status` (`beta`/`wartung`) filters |
| `service.get` | One active service by ID, with its documentation links and status |
| `service.search` | Fuzzy search by name, description, or category |
| `service.list_in_maintenance` | Active services currently tagged `wartung` |
| `category.list` | The catalog categories |
| `announcements.list` | Active announcements across all audiences (maintenance windows, outages) |

---

## Operations

Step-by-step runbooks for common operator tasks, grounded in what the code
actually does (not just what the spec aspires to):

- [Post / retire an outage announcement](docs/runbooks/outage-announcement.md)
- [Add / edit / remove a catalog service (form + MCP)](docs/runbooks/manage-service.md)
- [Restore PostgreSQL from backup](docs/runbooks/restore-postgres.md) (see also [Backups](#backups) for the scheduled job)
- [Revoke a compromised admin](docs/runbooks/revoke-admin.md)

---

## License

Apache 2.0
