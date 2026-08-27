# Spec — Responsive viewport testing (Playwright e2e harness)

Status: **ready to implement** · Owner: supervisor session · Written 2026-08-27

## 1. Why

End-user tests on real devices keep surfacing mobile bugs — especially **viewport overflows**
(horizontal scroll, elements poking past the screen edge, clipped text on long German labels).
None of the current gates catch these: Vitest component tests don't render at real viewports,
and the Playwright e2e layer that `docs/04` §3 calls for was never built.

This spec introduces that layer with a twist: its primary job is not flow coverage but
**layout correctness at fixed, common resolutions**, mobile and desktop alike. CLAUDE.md
("Responsive & viewport discipline") now makes this suite part of the definition of done for
any UI change.

## 2. Goals / non-goals

**Goals**
1. A Playwright harness that runs the **real embedded Go binary** (production artifact, not the
   Vite dev server) against Postgres + the mock OIDC IdP — the same stack CI already uses.
2. Every covered flow runs at a **fixed viewport matrix** (below).
3. Shared assertion helpers that fail the test on **overflow and readability** violations.
4. A CI job that gates PRs, and a one-command local run.

**Non-goals (for this slice)**
- Visual-regression screenshots (possible later; the harness should not preclude it).
- axe/a11y integration in e2e (exists at component level; a follow-up can add `@axe-core/playwright`).
- Load testing, real-device farms, browser matrix beyond Chromium (WebKit is a sensible
  follow-up for iOS fidelity — structure the config so adding it is one project entry).

## 3. Viewport matrix (fixed — mirror of CLAUDE.md)

| Project name | Size | Class | Notes |
|---|---|---|---|
| `mobile-324`  | 324×756   | phone  | Galaxy Z Fold7 cover display (effective CSS px) — the narrowest supported width, and where issue #23 reproduces; `isMobile`, `hasTouch`, DPR 3 |
| `mobile-360`  | 360×800   | phone  | small Android, the most common mobile width; `isMobile`, `hasTouch`, DPR 3 |
| `mobile-390`  | 390×844   | phone  | iPhone 12–16 class; `isMobile`, `hasTouch`, DPR 3 |
| `tablet-768`  | 768×1024  | tablet | iPad portrait — the list→table breakpoint boundary |
| `desktop-1280`| 1280×720  | desktop| smallest common laptop |
| `desktop-1920`| 1920×1080 | desktop| full HD |

Implement each as a Playwright **project** with a fixed `viewport` (do not use `devices[...]`
presets — fixed numbers keep failures reproducible and the matrix documented). All projects:
Chromium, `reducedMotion: 'reduce'` (stabilizes waits and respects the app's own
`prefers-reduced-motion` path), locale `de-DE`.

Theme: run the matrix in **light**; add a dark-mode spot check (one test toggling the theme)
at `mobile-390` and `desktop-1920` only — dark mode changes colors, not layout, so a full
matrix duplication buys little.

## 4. Architecture

```
web-ui/
  playwright.config.ts     # projects = the matrix; webServer starts the built binary
  e2e/
    helpers/viewport.ts    # the assertion helpers (§5)
    helpers/session.ts     # login via the mock IdP, reusable storageState
    fixtures.ts            # test fixture that auto-runs overflow checks (§5.4)
    dashboard.spec.ts
    search.spec.ts
    favorites.spec.ts
    announcements.spec.ts
    admin.spec.ts
```

- **App under test:** the embedded binary (`go build ./cmd/server` with the SPA copied into
  `internal/web/dist`, exactly like the CI "Build embedded binary" step). Playwright's
  `webServer` starts it with `DATABASE_URL`, `OIDC_ISSUER_URL` (the mock IdP), `PUBLIC_URL=
  http://localhost:<port>`, `SESSION_SECRET=e2e-not-secret`. Rationale: what we ship is what
  we test — dev-server-only layout differences (unbuilt CSS, HMR wrappers) can't leak through.
- **Auth:** the mock-oauth2-server config (`dev/mock-oidc-config.json` / the CI `JSON_CONFIG`)
  has `interactiveLogin: false` and maps `client_id: wolke` → a user with
  `eduPersonAffiliation: student` + `groups: [dashboard-admins]`. So `page.goto('/')` follows
  the redirect chain and lands authenticated, with admin access — one identity covers user and
  admin screens. Do the login once in a setup project and share `storageState` across tests.
- **Fixture data:** the dev seed (`dev/seed.sql`) provides the catalog. For overflow tests we
  need pathological content; **do not edit `dev/seed.sql`** (backend integration tests assert
  against it). Instead, a global-setup step creates via the admin API (`POST
  /api/admin/services`) a dedicated fixture service with worst-case strings — name
  `Netzlaufwerkverbindungsverwaltung`, a long unbroken-compound description, max keywords —
  and deletes it (soft) in teardown. Tag it (e.g. name prefix `E2E-`) so tests can target it.

## 5. The assertion helpers (the actual point)

`e2e/helpers/viewport.ts` exports:

### 5.1 `expectNoHorizontalOverflow(page)`
- `document.scrollingElement.scrollWidth <= window.innerWidth` (±1px tolerance for
  subpixel rounding). This is the headline "no horizontal scroll on the page" check.
- Walk all **visible** elements (`checkVisibility()`, skip `aria-hidden` subtrees and
  `position: fixed` elements that are intentionally off-canvas while closed, e.g. dialogs and
  the assistant launcher panel): assert `getBoundingClientRect()` stays within
  `[−1, innerWidth + 1]`.
- **Sanctioned scroll containers are exempt inside, not outside:** an element whose computed
  `overflow-x` is `auto`/`scroll` may have `scrollWidth > clientWidth` (that's what it's for),
  but its own box must still fit the viewport. Everything else with `scrollWidth >
  clientWidth + 1` **and** `overflow-x: visible/clip/hidden` without `text-overflow: ellipsis`
  is reported as clipped/overflowing content.
- On failure, report a useful message: tag name, id/class, text snippet, rect vs viewport —
  a bare `expect(false)` here would make every regression a debugging session.

### 5.2 `expectReadableText(page)`
- Every visible element that directly contains non-whitespace text has computed
  `font-size >= 12px`.
- No visible text element is rendered at effectively zero size (`rect.height > 0`).

### 5.3 `expectTouchTargets(page)` — mobile projects only
- Every visible interactive element (`a[href]`, `button`, `[role=button]`, inputs, the tile's
  three controls) has a hit area of **≥ 44×44px** (per `docs/03` §4), measured as the bounding
  rect or a padded parent that is itself the click target. Allowlist mechanism (a
  `data-e2e-small-target-ok` attribute) for the rare deliberate exception — used sparingly and
  reviewed.

### 5.4 Auto-check fixture
Export an extended `test` from `e2e/fixtures.ts` whose `page` fixture runs
`expectNoHorizontalOverflow` + `expectReadableText` (+ `expectTouchTargets` when
`isMobile`) **automatically after each test**, on whatever state the test ended in. Specs then
also call the helpers explicitly after opening each intermediate state (menu open, dialog
open, tile expanded), since only the final state is checked automatically. This keeps "every
tested state is overflow-checked" the default, not a per-test chore.

## 6. Flows to cover (initial suite — every one runs at all 6 viewports)

1. **Dashboard**: land logged-in → default view renders; check both **list and table** view
   modes (toggle), category sections, the `E2E-` long-compound tile visible.
2. **Tile interaction**: expand "More details" (checked expanded), star toggle, doc-only tile.
3. **Search**: open search, type a query with results, and a zero-result query (empty state);
   results panel checked open.
4. **Favorites tab**: with ≥1 favorite, plus the empty state.
5. **Announcements**: an active warning announcement (create via admin API in the test) —
   banner checked; notification center (bell) open.
6. **Account menu / top bar**: menu open; language switch to `en` renders without overflow.
7. **Admin**: services table, service create/edit dialog **open** (dialogs are prime overflow
   offenders on 360px), icon picker open, categories view, audit log.
8. **Dark-mode spot check** (2 viewports, see §3).

## 7. CI & local workflow

- **CI:** a new `e2e` job in `ci.yml`, `needs: frontend` (reuses the `spa-dist` artifact),
  with the same `postgres` + `mock-oidc` service blocks and migrate/seed steps as the
  `backend` job. Steps: setup Go + Node → download `spa-dist` → copy into
  `internal/web/dist` → `go build -o bin/server ./cmd/server` → `npx playwright install
  --with-deps chromium` → `npx playwright test`. Upload the Playwright HTML report as an
  artifact on failure. The `image` job gains `needs: [frontend, backend, e2e]` so nothing
  publishes with a red viewport suite.
- **Local:** `make e2e` — builds the SPA + binary and runs the suite against the local
  Postgres + mock IdP (same env as `make dev`); `make e2e-ui` for `playwright test --ui`.
  Document both in the README dev section.
- Playwright is a `devDependency` of `web-ui`; e2e specs are excluded from Vitest
  (`vitest.config` exclude `e2e/**`) and from `tsc --noEmit`'s app config if needed
  (separate `tsconfig.e2e.json` extending the base).

## 8. Implementation order (one PR each, spec → tests → code)

1. **Harness + smoke**: config, webServer wiring, session helper, the §5 helpers with unit
   coverage of the helper logic where practical, and flow 1 (dashboard) green at all six
   viewports. CI job wired. — *This PR is the milestone; everything after is additive.*
2. **Core flows**: 2–6.
3. **Admin flows**: 7 + the fixture-service setup/teardown + dark-mode spot check.

If step 1 surfaces real overflow bugs (likely — that's the motivation), **file them and fix
them in separate follow-up PRs**; don't let the harness PR balloon. A known failure can be
temporarily `test.fixme`-annotated with an issue link, never silently skipped.

## 9. Acceptance criteria

- `npx playwright test` green locally and in CI at all six viewports; suite runtime < ~5 min
  in CI.
- Deliberately breaking a layout (e.g. an unwrapped long string in a tile name at 360px)
  fails the suite with a message naming the offending element.
- No changes to `dev/seed.sql`; backend job untouched and green.
- CLAUDE.md matrix, this spec, and `playwright.config.ts` agree on the resolutions.
- README documents `make e2e` / `make e2e-ui`.
