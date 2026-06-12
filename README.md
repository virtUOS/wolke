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

The primary loop runs the Go API and the Vite dev server directly against a local
Postgres — no containers in the inner loop, no TLS, no embedded build (docs/04 §4).
Requires Go 1.26, Node 24, and podman (for Postgres).

```bash
cp .env.example .env            # adjust if needed; DATABASE_URL matches `make db`
make db                         # start Postgres 17 (podman), one-time
make migrate                    # apply migrations (goose)
make web-install                # one-time: install frontend deps

# then two terminals:
make run                        # A: Go server on http://localhost:8080
make web-dev                    # B: Vite SPA on http://localhost:5173 (proxies /api → :8080)
```

Open the Vite URL it prints (5173, or the next free port). The SPA fetches
`/api/branding` through the proxy and themes itself at runtime. `make run` serves
the API and a placeholder shell; the real SPA in dev comes from Vite.

Useful targets (`make help` lists all):

| Command | What it does |
|---------|--------------|
| `make check` | Full local gate: gofmt + vet + `go test -race`, then frontend typecheck/lint/test |
| `make sqlc` | Regenerate type-safe queries after editing SQL |
| `make migrate` / `make migrate-down` | Apply / roll back migrations |
| `make build` | Build the single binary with the SPA **embedded** (prod-like) |

Integration tests that need Postgres read `DATABASE_URL` and **skip** when it is
unset, so `go test ./...` is safe without a database; `make test` (after `make db
&& make migrate`) runs them for real.

The end-to-end Compose stack (app + Postgres + Caddy + a dev IdP) lives in
`compose.yaml` and is for staging / a pre-release check — it does not constrain
daily work.

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
