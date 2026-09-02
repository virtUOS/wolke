# CLAUDE.md — wolke

Standing instructions for working in this repo. Read `docs/01`–`docs/04` for the full spec.

## What this is
A role-aware, authenticated university IT-service launcher. Go modular monolith + embedded
React/TS SPA, PostgreSQL, **generic (configurable) OIDC** via the BFF pattern, Prometheus metrics,
and an admin MCP server. Deploys as **Docker Compose behind Caddy**; develops locally without
Docker. Usability and simplicity are the product goals — prefer the boring, simple option.

## Golden rules
1. **Work in phases** (`docs/04` §2). Don't scaffold features from a later phase early.
2. **Spec → tests → code.** Write failing tests first, then implement to green.
3. **One use-case layer.** All writes and business rules live in `/internal/service`.
   HTTP handlers and MCP tools are thin wrappers that call it. Never duplicate validation.
4. **MCP writes are staged.** `propose_*` must never mutate state; only `change.confirm` writes,
   and every write is audit-logged. There is a test that enforces this — keep it green.
5. **No tokens in the browser.** Auth is the BFF pattern: server-side session + httpOnly cookie.
6. **The catalog is data, not code.** Don't hardcode services; they come from the DB via admins.
7. **Accessibility is not a phase-5 afterthought** — every interactive element ships keyboard-
   operable with visible focus and correct ARIA.
8. **Built to be reused as open source.** OIDC is provider-agnostic (discovery + a configurable
   claim→role/admin mapping — never Keycloak-specific code), and branding (colors, logo, product
   name) is runtime config served at `/api/branding`. UOS is the default skin, not an assumption.
   Don't hardcode an institution, an IdP, brand colors, or a logo anywhere.

## Conventions
- **Go:** stdlib idioms, `log/slog` (JSON), errors wrapped with context, no panics in handlers.
  `gofmt` + `golangci-lint` clean. Queries via sqlc; migrations via goose, forward-only.
- **TS/React:** function components + hooks, TanStack Query for all server state, no browser
  storage of app data (prefs persist via the API), shadcn/ui primitives over hand-rolled ones
  (reusable primitives live in `web-ui/src/components/ui/` — see its README for the conventions;
  they're pure presentation, data lives in containers), `lucide-react` for icons (validate names
  against the allowlist used by the backend).
- **Styling:** Tailwind + the CSS-variable tokens in `docs/03`. Brand red = brand + interaction
  only. Respect `prefers-reduced-motion`.
- **i18n:** localized strings as `{de,en}`; ship `de`, keep `en` wired. Never break layout on long
  German compounds.

## Responsive & viewport discipline

Real-device testing showed mobile UX regressions (especially viewport overflows) slipping
through. Treat responsive correctness like a11y: a floor, not a polish phase.

- **Mobile-first, always.** Any UI change is designed and verified at the phone layout before
  the desktop one. Long German compounds and real content lengths, not lorem ipsum.
- **Design for the standard phones; the Fold is a floor, not a target.** Tune layout, density
  and aesthetics for **360×800 and 390×844** (what most users hold). **324×756** stays in the
  matrix as a correctness floor — no overflow, readable, tappable — but don't optimize the
  look for it, and never let the narrowest width drive a design that costs the standard sizes
  (e.g. text columns squeezed by fixed-width controls).
- **The viewport matrix is fixed.** Playwright e2e runs every UI-relevant flow at these
  resolutions (see `docs/specs/responsive-viewport-testing.md` for the harness):
  - Mobile: **324×756** (Galaxy Fold cover display — the narrowest we support), **360×800**
    (small Android), **390×844** (iPhone-class)
  - Tablet: **768×1024**
  - Desktop: **1280×720**, **1920×1080**
- **Overflow is a test failure, not a review nit.** The shared viewport assertions check, on
  every tested page/state: no horizontal document scroll, no element extending past the
  viewport width, no unintended clipped/overlapping text, touch targets ≥ 44px at mobile
  sizes, and computed body text ≥ 12px.
- **New UI ships with viewport coverage.** A feature that adds or changes a screen, dialog,
  or layout state adds it to the e2e viewport suite (all matrix sizes) in the same PR.

## Definition of done for any change
- Tests written and passing (unit + integration where it touches the DB or auth).
- `go test -race ./...`, `tsc --noEmit`, lints, and the embedded build all green.
- a11y checked (axe + keyboard) for any UI.
- Playwright viewport suite green across the full matrix for any UI change; new screens/states
  added to it (see "Responsive & viewport discipline").
- New write paths are audited and, if admin-relevant, exposed through both form and MCP via the
  shared service layer.
- Docs updated if behavior or the data model changed.

## Don't
- Don't add Redis, a message queue, GraphQL, or a second datastore unless `docs/02` §9 says the
  HA trigger has actually been hit.
- Don't expose `/metrics` publicly.
- Don't let an MCP tool write without a confirmed, unexpired change token.
- Don't invent brand hex values — use the tokens file; flag if the official values are still TBD.

## Commits and CI

- **Commit messages carry no Claude co-authorship.** No `Co-Authored-By: Claude`, no "Generated with Claude Code", no tool attribution of any kind. This is not negotiable and applies to every commit.
- **Container images build in GitHub Actions and publish to ghcr.io.** Never build or push images from a local machine — local podman and production docker must not diverge in what they run. amd64 only; there is no GPU story on arm here.
- **Build output is never committed.** `internal/web/dist/` holds only a tracked `.gitkeep`; `index.html` and the hashed assets are generated by `make web-build && make embed` (or the Docker/CI build) and stay untracked. A dirty `internal/web/dist` after building is a bug, not something to commit.
