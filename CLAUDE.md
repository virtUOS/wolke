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

## Definition of done for any change
- Tests written and passing (unit + integration where it touches the DB or auth).
- `go test -race ./...`, `tsc --noEmit`, lints, and the embedded build all green.
- a11y checked (axe + keyboard) for any UI.
- New write paths are audited and, if admin-relevant, exposed through both form and MCP via the
  shared service layer.
- Docs updated if behavior or the data model changed.

## Don't
- Don't add Redis, a message queue, GraphQL, or a second datastore unless `docs/02` §9 says the
  HA trigger has actually been hit.
- Don't expose `/metrics` publicly.
- Don't let an MCP tool write without a confirmed, unexpired change token.
- Don't invent brand hex values — use the tokens file; flag if the official values are still TBD.
