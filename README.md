# wolke

A role-aware IT service launcher for universities. Staff, teachers, and students each land on a dashboard pre-arranged for their kind of work — they can search the full service catalog, pin favorites, and stay informed through announcements. Admins curate the catalog and default views through a form UI or an MCP server.

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

### Other useful targets

```
make test         Run Go tests with the race detector
make lint         Run golangci-lint
make web-check    Frontend typecheck + lint + tests
make check        Run the full local gate (Go + frontend combined)
make migrate-down Roll back the last migration
make sqlc         Regenerate type-safe queries from SQL (after editing *.sql)
make build        Build a single binary with the SPA embedded → bin/server
make mcp          Build the admin MCP server → bin/mcp
make clean        Remove build artifacts
```

---

## Deployment (Docker Compose)

The `Dockerfile` builds the SPA (Node), embeds it into a static Go binary, and produces **two small distroless images**: `runtime` (the app, ~20 MB) and `migrate` (goose + the SQL migrations, ~40 MB — no compiler or source). Both run as a non-root user with read-only root filesystems.

### The shipped stack (`compose.yaml`)

The repo ships a production-shaped `compose.yaml`: Caddy terminates TLS and is the only exposed surface, the app and a one-shot migrate step sit behind it, and Postgres lives on an internal-only network with no route to the internet. Every service drops Linux capabilities, runs read-only, and sets `no-new-privileges`; Caddy waits on the app's `/readyz` healthcheck before accepting traffic.

Secrets **fail closed** — set them (in a `.env` next to `compose.yaml`, or the environment) or `compose up` aborts rather than booting with a default:

```bash
POSTGRES_PASSWORD=$(openssl rand -base64 24)
SESSION_SECRET=$(openssl rand -base64 32)
```

Then:

```bash
docker compose up -d          # or: podman-compose up -d
```

Caddy serves HTTPS on :443 (its internal CA for `localhost`; real certificates for a public hostname). Rootless podman can't bind <1024 — set `CADDY_HTTPS_PORT=8443` then.

### Adapting it

A minimal app + migrate pair, if you wire your own proxy and database:

```yaml
services:
  migrate:
    build:
      context: .
      target: migrate              # tiny goose image; migrations are baked in
    command: ["postgres", "${DATABASE_URL}", "up"]
    depends_on: [db]
    restart: on-failure

  app:
    build: .                       # default target = runtime
    environment:
      DATABASE_URL: postgres://wolke:…@db:5432/wolke?sslmode=disable
      PUBLIC_URL: https://wolke.example.edu
      SESSION_SECRET: "openssl rand -base64 32"
      OIDC_ISSUER_URL: https://your-idp.example.edu/realms/uni
      OIDC_CLIENT_ID: wolke
      OIDC_CLIENT_SECRET: "your-client-secret"
      TRUSTED_PROXIES: "10.0.0.0/8"
      CONFIG_FILE: /config.yaml
      BRANDING_DIR: /branding
    volumes:
      - ./branding:/branding:ro
      - ./config.yaml:/config.yaml:ro
    depends_on:
      migrate:
        condition: service_completed_successfully
```

Put Caddy (or nginx) in front on port 443. `TRUSTED_PROXIES` must cover the proxy's network so `X-Forwarded-For` is trusted.

**Branding and OIDC claim mapping** live in `config.yaml` (copy from `config.example.yaml`). This is the one file you edit to reskin for a different institution — colors, logo paths, product name, and which OIDC claim maps to which role.

**Migrations run automatically** via the `migrate` service on every deploy. They are forward-only (goose); rolling back requires an explicit `make migrate-down` in dev.

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

## License

Apache 2.0
