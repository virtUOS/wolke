# 04 — Development, Testing & Maintenance Plan

## 1. How to build this with Claude Code

A few habits keep an agentic build on the rails:

- **Phase by phase.** Never "build the whole app." Each phase below is a self-contained milestone
  with a demoable result. Finish and merge one before starting the next.
- **Spec → tests → code.** For each feature, point Claude Code at the relevant section of docs
  01–03, ask it to write the failing tests first, then implement until green.
- **`CLAUDE.md` at the repo root** (provided in this package) carries the standing conventions so
  you don't repeat them every session.
- **Small PRs.** One feature or vertical slice per branch. Run the full test + lint + typecheck
  gate before merge.
- **Keep the use-case layer central.** When adding a write path, add it to `/internal/service`
  and wire *both* the HTTP handler and (when relevant) the MCP tool to it. Don't duplicate logic.

## 2. Phased roadmap

### Phase 0 — Foundations (skeleton that runs)
- Repo, `CLAUDE.md`, CI (lint, vet, typecheck, test).
- **Local dev loop without Docker:** `go run ./cmd/server` + Vite dev server against a local
  Postgres; document it as the primary workflow. Add `compose.yaml` + `Caddyfile` (app + Postgres
  + Caddy + a dev IdP) for the end-to-end/staging path — present but not required for daily work.
- Go server skeleton (chi, slog, **config loader: env > file > defaults**, `PUBLIC_URL`, proxy-aware
  `X-Forwarded-*`, `/healthz`), `embed.FS` wiring for the SPA.
- Vite + React + TS + Tailwind + shadcn/ui + lucide scaffold; **`GET /api/branding` + runtime theme
  application** so the default tokens (doc 03) load from config, not the bundle.
- First migration; sqlc generating; pgx pool.
- **Done when:** the app runs locally (no Docker) serving an empty themed shell behind a login
  redirect stub, *and* `docker compose up` serves the same behind Caddy.

### Phase 1 — Auth + read-only catalog (the core loop)
- **Generic OIDC BFF** (tech spec §6): login, callback, session, logout against any discovery-based
  IdP; role + admin resolution driven by the **configurable claim mapping** (not hardcoded). Test
  against a dev IdP (Keycloak or Authentik container) and assert the mapping is config-driven.
- Catalog model + seed data; in-process catalog cache; `GET /api/catalog`, `/api/me`, `/api/catalog/defaults`.
- The **tile component** with all states (doc 03 §5); **List** and **Table** views; theme toggle; view-mode persistence.
- Role-based default view; **search** (`pg_trgm`).
- **Done when:** a logged-in student sees their default view, switches list/table + theme, searches,
  expands a tile, and launches a service in a new tab. This is the product's spine — get it right.

### Phase 2 — Personalization
- Favorite lists + items; quick-star (default list) and add-to-list dialog; reorder.
- Click event ingestion (`POST /api/events/click`) + **frequently used** (`/api/usage/frequent`).
- Doc-only entries rendered distinctly.
- **Done when:** a user pins services into named lists and "frequently used" reflects real clicks.

### Phase 3 — Admin (form path) + announcements
- Admin guard; admin CRUD form with live tile preview, icon picker, multi-category, URL validation, soft-delete.
- Role-default editor. Categories management. Audit log writes.
- Announcements: model, role-scoped banner, severity, time window, admin authoring.
- **Done when:** an admin adds/edits/removes a service and posts an outage banner, all audited.

### Phase 4 — Observability + admin MCP
- Prometheus `/metrics` (clicks-by-role, sessions, request histogram, catalog gauges); usage rollup job; Grafana dashboard JSON.
- Admin **MCP server** (`/cmd/mcp`) with `propose_* → preview → change.confirm` (tech spec §8), sharing `/internal/service`; MCP changes audited as `actor_kind='mcp'`.
- **Done when:** an admin adds a service via chat, sees a preview, confirms, and it appears live and audited;
  Grafana shows clicks per service per role.

### Phase 5 — Polish + hardening (Claude Design)
- Claude Design pass: tile micro-interactions, spacing, table density, empty/loading/error states, motion.
- Accessibility audit (axe + manual keyboard/screen-reader), full German-language pass (compound nouns, ß).
- Security headers/CSP/CSRF/rate limits; load test to the 2–3k concurrency target; cache tuning.
- **Done when:** the a11y, performance, and security gates in §6 all pass and it feels effortless on a phone.

### Future (designed-for, not built)
- Read-only end-user "which service do I need?" MCP server (tech spec §8).
- Redis + multi-instance if an HA requirement appears (tech spec §9).
- English locale switched on.

## 3. Testing strategy

Match effort to risk: the auth flow, the use-case/validation layer, the MCP confirm contract, and
the tile interaction are where bugs hurt — test those hardest.

**Backend (Go)**
- Unit: `/internal/service` validation and business rules with table-driven `testing` tests.
- Handler: `net/http/httptest` against the real router with a faked session.
- DB/integration: run queries against a **real Postgres** via testcontainers (or `dockertest`) —
  catches sqlc/SQL drift that mocks hide.
- Auth: integration test against a **Keycloak dev container**; assert role/admin resolution and
  that token revocation removes admin at next login.
- MCP: contract tests asserting `propose_*` **never writes**, that an invalid/expired token is
  rejected, and that `change.confirm` writes + audits exactly once.

**Frontend**
- Component: **Vitest + Testing Library** — the tile's launch-vs-expand split, star toggle,
  keyboard operation, empty/error states.
- E2E: **Playwright** — login → see default view → search → favorite → launch; admin create flow;
  run in both themes and at a mobile viewport.
- Accessibility: **axe** in component + e2e tests; manual keyboard/SR pass each phase.

**Non-functional**
- Load: **k6** simulating ~3k concurrent users, catalog-read-dominant, asserting cache hit rate
  and p95 latency under target on a single instance.
- Visual regression (optional): Playwright screenshots of the tile state matrix.

**Gates (CI):** `go vet` + `golangci-lint`, `gofmt`, `go test ./...` with race detector,
`tsc --noEmit`, ESLint, frontend tests, and a build of the embedded binary. Nothing merges red.

## 4. Deployment

**Production = Docker Compose behind Caddy.** Caddy is the only thing exposed; it terminates TLS
(automatic certs) and reverse-proxies to the app. The app, Postgres, and (optionally) the IdP live
on the internal Compose network. Compose wiring can come late — it doesn't constrain development —
but the app is built proxy-aware from the start (tech spec §3, §10): trust `X-Forwarded-*` from
Caddy, take `PUBLIC_URL` from config for OIDC redirects and `Secure` cookies.

```
                 ┌─────────────── docker compose ───────────────┐
   Internet ──►  │  caddy  ──►  app (Go binary + embedded SPA)   │
        (443)    │   │                 │                          │
                 │   └─ TLS, certs     └──► postgres (volume)     │
                 └──────────────────────────────────────────────┘
                       app ──► IdP (external, or its own service in dev)
```

- **Artifact:** one app container image — multi-stage build (Vite build → embedded into the Go
  binary). Plus stock `caddy` and `postgres` images. A committed `Caddyfile` and `compose.yaml`.
- **Local development (no Docker needed):** run `go run ./cmd/server` + the Vite dev server
  directly, against a local Postgres (bare install or a one-line `docker run postgres` if you
  prefer). No Caddy, no TLS, no container build in the inner loop — fast iteration. The Compose
  stack is for staging/prod and for an end-to-end check before release.
- **Config:** env + mounted files (tech spec §11): `DATABASE_URL`, `PUBLIC_URL`, `SESSION_SECRET`,
  `OIDC_*` + claim-mapping file, `branding.yaml` + logo assets, `METRICS_TOKEN`. No secrets baked
  into images; mount `branding/` and config as Compose volumes so a re-skin/re-point is a restart.
- **Scale:** single app instance is sufficient for the stated load. If HA is required, run 2+ app
  replicas behind Caddy and add Redis for shared sessions + cache invalidation (tech spec §9).
- **Migrations** run on deploy (goose), forward-only, reviewed.
- **Rollout:** stand up a staging Compose stack pointed at a staging IdP realm; pilot with a small
  admin group; then GA. Because branding/OIDC are config, another institution deploys the same
  images with their own `branding.yaml` + claim mapping.

## 5. Maintenance & operations

- **The catalog is living data**, not code. Admins (form or MCP) own it; engineering rarely touches it.
  This is the whole point of the admin paths — keep that separation so monthly service churn never
  needs a deploy.
- **Observability:** Prometheus + the shipped Grafana dashboard (clicks per service/role, latency,
  active sessions, active announcements); slog JSON logs to the university's log sink; alert on
  error rate, p95 latency, and Postgres health. Optional OpenTelemetry tracing if you already run a collector.
- **Audit:** every catalog/announcement change (form and MCP) is in `audit_log` — the answer to
  "who changed this service and when."
- **Data hygiene:** scheduled rollup of `click_events` → `usage_daily`; purge raw events past the
  retention window (concept §8.9); keep aggregates. Coordinate the privacy notice with the DSB.
- **Backups:** regular Postgres backups + a tested restore. The catalog and favorites are the
  irreplaceable data.
- **Dependencies:** Dependabot/Renovate for Go modules and npm; pin and review. Keep Go and Node LTS current.
- **Runbooks:** (1) post an outage announcement; (2) add/remove a service via form and via MCP;
  (3) restore from backup; (4) revoke a compromised admin (remove the Keycloak group). Write these
  as the features land, not after.

## 6. Definition of done (whole product)
- Logged-in users of all three roles get a sensible default view and can find, launch, favorite,
  and return to services on phone and desktop, in light and dark.
- Admins manage the catalog and announcements via form **and** MCP, with preview/confirm and audit.
- `/metrics` exposes clicks by service and role; Grafana renders it.
- a11y (AA, keyboard, SR), security (CSP/CSRF/rate-limit/protected metrics), and load (3k concurrent,
  p95 within target) gates pass.
- The ten open decisions in concept §8 are answered and reflected in the code/config.
