# UOS Service Hub — Planning Package

> Working title. A personalized, authenticated portal that gets every member of the
> university to the right IT service (or its documentation) in as few taps as possible.
> Think *Homer*, but multi-tenant by role, branded, searchable, and admin-managed.

This folder is the **product concept and development plan**, written to be handed to
Claude Code as the source of truth. Read the docs in order; each builds on the last.

## Documents

| File | What it covers |
|------|----------------|
| [`docs/01-product-concept.md`](docs/01-product-concept.md) | Vision, users, the core UX, every feature resolved into concrete behaviour, and the open decisions you still need to make. |
| [`docs/02-technical-spec.md`](docs/02-technical-spec.md) | Recommended stack (and why), architecture, data model, REST API, auth, caching, metrics, and the admin MCP server. |
| [`docs/03-design-system.md`](docs/03-design-system.md) | Design language, UOS color tokens, typography, the signature tile component, dark/light mode, and accessibility floor. |
| [`docs/04-development-plan.md`](docs/04-development-plan.md) | Phased roadmap, how to drive each phase with Claude Code, testing strategy, deployment, and maintenance/ops. |
| [`CLAUDE.md`](CLAUDE.md) | Standing instructions for Claude Code: conventions, guardrails, definition of done. Drop this at the repo root. |

## TL;DR of the recommendation

- **Backend:** Go modular monolith — `net/http` (chi router), PostgreSQL via `pgx`+`sqlc`,
  generic OIDC via `coreos/go-oidc`, metrics via `prometheus/client_golang`. One binary.
- **Frontend:** React + TypeScript + Vite + Tailwind + shadcn/ui + `lucide-react`,
  built and **embedded into the Go binary** (`embed.FS`). One app image.
- **Auth:** **provider-agnostic OIDC** (discovery-based; Keycloak/Authentik/Zitadel/Auth0/…) using
  the **BFF pattern** — the Go server runs the code flow and issues an httpOnly session cookie; the
  SPA never touches tokens. Role + admin come from a **configurable claim mapping**, not hardcoded.
- **Reusable as open source:** OIDC, **branding (colors + logo + name)**, and locale are all runtime
  config — a fork re-skins and re-points by editing files and restarting, no recompile.
- **Admin:** a web form **and** a separate MCP server exposing `service.*` tools with a mandatory
  **preview → confirm** step before any write.
- **Deployment:** **Docker Compose behind a Caddy reverse proxy** (TLS at Caddy; app is proxy-aware).
  Daily development runs locally **without Docker** for a fast loop.
- **Scale:** 2–3k concurrent, read-heavy. A single instance with an in-process catalog cache
  handles it. Redis only enters the picture if you run multiple instances.

## Local development (no Docker)

Login is always required, so a working setup needs the database **and** an IdP:
the authenticated endpoints (`/api/me`, `/api/catalog`, …) only exist when OIDC is
configured — otherwise the SPA can't load. `.env.example` points OIDC at the local
mock from `make idp`. Requires Go 1.26, Node 24, and podman.

One-time setup:

```bash
cp .env.example .env            # OIDC already points at the make idp mock
make idp                        # mock IdP on :8455 (auto-issues a student+admin)
make db && make migrate && make seed
make web-install
```

**Quickest way to see it running** — the embedded single-origin build:

```bash
make serve                      # builds the SPA into the binary, loads .env, runs it
# open PUBLIC_URL (http://127.0.0.1:8080); you're auto-logged-in via the mock
```

**Active development (HMR)** — Go API + Vite, two terminals:

```bash
make run                        # A: Go API on :8080 (loads .env)
make web-dev                    # B: Vite SPA (proxies /api,/auth → :8080)
```

For the Vite loop the browser hits Vite, which bypasses the server's login gate,
so the SPA redirects to `/auth/login` itself on a 401. For that round-trip to land
back in Vite, set `PUBLIC_URL` in `.env` to the **Vite origin** it prints (e.g.
`http://localhost:5173`, or `5174` if 5173 is taken) before `make run`.

Useful targets (`make help` lists all):

| Command | What it does |
|---------|--------------|
| `make check` | Full local gate: gofmt + vet + `go test -race`, then frontend typecheck/lint/test |
| `make sqlc` | Regenerate type-safe queries after editing SQL |
| `make migrate` / `make migrate-down` | Apply / roll back migrations |
| `make build` | Build the single binary with the SPA **embedded** (prod-like) |

Integration tests that need Postgres read `DATABASE_URL` and **skip** when it is
unset, so `go test ./...` is safe without a database; `make test` (after `make db
&& make migrate`) runs them for real. The OIDC BFF integration test additionally
needs a mock IdP — `make idp` starts one on :8455, then:

```bash
OIDC_TEST_ISSUER=http://127.0.0.1:8455/default make test   # use 127.0.0.1, not localhost
```

To run the app against the mock for manual login, set `OIDC_ISSUER_URL`,
`OIDC_CLIENT_ID=service-hub`, and a `SESSION_SECRET` in `.env` before `make run`.

### End-to-end stack (Compose, for staging / pre-release)

`compose.yaml` runs the production-shaped stack — Caddy (TLS) → app → Postgres,
plus a one-shot `goose` migrate step and an optional mock OIDC IdP. It is **not**
the daily loop; use it to check the real embedded image behind the proxy.

```bash
podman compose up -d --build        # build images + start postgres, migrate, app, caddy
podman compose --profile idp up -d  # also start the mock OIDC IdP (Phase 1)
```

Caddy listens on 80/443 by default (production-correct). **Rootless podman can't
bind ports < 1024** — override with high ports:

```bash
CADDY_HTTP_PORT=8080 CADDY_HTTPS_PORT=8443 podman compose up -d --build
# then: curl -k https://localhost:8443/
```

The app trusts `X-Forwarded-*` only from the Compose subnet and takes its public
URL from `PUBLIC_URL`, so Secure cookies and (Phase 1) OIDC redirects are correct
even though TLS terminates at Caddy. `/metrics` is blocked at the proxy.

## How to start with Claude Code

1. Put these docs in a fresh repo and copy `CLAUDE.md` to the root.
2. Work **phase by phase** (see doc 04). Don't ask Claude Code to "build the whole thing."
3. For each feature, point it at the relevant spec section and ask for **tests first**.
4. Use **Claude Design** for the polish pass in Phase 5, after the structure is stable.

## Decisions you still need to confirm

These are listed in full at the end of `docs/01-product-concept.md`. The big ones (all now
expressed as *config* so other institutions can adapt the hub): exact UOS brand hex values +
logo assets for the default `branding.yaml`, the precise OIDC claim → role/admin mapping for the
UOS IdP, whether documentation is truly always external, and the Compose/Caddy hosting specifics.
