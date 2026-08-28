# Spec — Road to production v1

Status: **agreed 2026-08-27** · Owner: supervisor session

Goal: the **quickest defensible path to a production deployment** we can then improve in small
iterations. Everything not required for a trustworthy launch is deliberately deferred to
post-launch — shipping and iterating beats polishing in staging.

## Settled decisions (2026-08-27)

- **#26 — services open in a new tab.** Confirmed; the docs' existing behavior stands.
  Consequence for **#27**: since new-tab stays, returning to wolke with a stale search is real —
  fix by **resetting/closing the search when a service is launched from a result**.
- **Assistant widget is disabled at launch.** `ASSISTANT_WIDGET_URL` stays empty in the
  production config. #45 and #53 move to post-launch (they need a design rethink on the eule
  side, not a quick fix). The `bot_url`/`help_url` top-bar links remain available if wanted.
- **Viewport matrix includes the Galaxy Fold cover display**: 324×756 is the narrowest
  supported width (issue #23 reproduces there). Full matrix: 324×756, 360×800, 390×844,
  768×1024, 1280×720, 1920×1080 (CLAUDE.md + `responsive-viewport-testing.md`).

## Milestones

### M0 — Housekeeping (supervisor + a short session)
- New branch off `main`; commit the CLAUDE.md updates (Commits/CI section, responsive
  discipline) and the two specs in `docs/specs/`.
- Clean the working tree: gitignore or remove the loose artifacts (screenshot, HAR,
  `wolke Design System.zip`, `catalog_seed.sql`, `services.yml`, `notes` stays local).
- Note the stale local branches (main history was rewritten; `backup/main-pre-rewrite` is the
  keeper) — prune the merged ones when convenient.

### M1 — Viewport harness + mobile fixes ← **start here**
The "review session": targeted, test-first, not a broad audit.
- Build the Playwright harness per `docs/specs/responsive-viewport-testing.md` (PR 1 of that
  spec: config, webServer on the embedded binary, session helper, assertion helpers, dashboard
  smoke at all six viewports, CI `e2e` job).
- Write **failing reproductions first** for:
  - **#23** header overflow on mobile portrait (reproduce at `mobile-324`; also reconsider the
    floating button, which covers content on narrow/short screens — reporter flagged it twice),
  - **#33** unexpected empty space at the bottom on mobile,
  - **#35** desktop-only elements visually hidden on mobile but still exposed to screen
    readers (rule: content hidden on mobile *to reduce information* must be `display:none`/
    `aria-hidden`, not just visually offscreen; content for SR-only benefit stays).
- Fix to green. Layout fixes in follow-up PRs to the harness PR, not bundled.
- **Exit:** e2e job green in CI at all six viewports; #23, #33, #35 closed with regression tests.

### M2 — UX bug batch (one session, small PRs)
- **#31** category filter resets when leaving/re-entering Services (also on re-clicking the
  active Services tab). Check the stale `fix/mobile-filter-reset` branch for prior art first.
- **#30** `cursor: pointer` on the section tabs.
- **#28** menu consistency: give the theme menu an explicit **Auto** option like language
  (system-following; both menus behave identically). Backend already models
  `theme in ('light','dark','system')` — this is likely UI-only.
- **#27** launching a service from search results closes/clears the search overlay.
- Each change lands with a viewport-suite addition where it touches layout.
- **Exit:** all four closed, suite green.

### M3 — Auth hardening (the substantial pre-production item)
- **#44 OIDC back-channel logout.** wolke only does wolke-initiated logout today; IdP-initiated
  logout must revoke the wolke session. Implement `POST /auth/backchannel-logout` per the OIDC
  Back-Channel Logout spec: validate the logout token against the discovered JWKS, revoke
  sessions by `sid` (store `sid` from the ID token in the session at login) with `sub` as
  fallback. Provider-agnostic (golden rule 8) — advertised only if the deployment registers it;
  document the Keycloak client setting in `docs/oidc-keycloak.md`. Integration-test against the
  mock IdP / Keycloak container: SSO logout → next wolke request is unauthenticated.
- Run a focused **/security-review** session over `internal/auth` + session handling in the
  same milestone; fix what it finds or file it.
- **Exit:** #44 closed with an integration test; security review findings triaged.

### M4 — Launch prep
- Production config pass: `branding.yaml` with real UOS values (concept §8.1 — chase the
  official hex values), claim mapping confirmed against the UOS IdP (#8.2/8.3), widget off,
  `announcement_retention_days`, retention/backup settings.
- Runbooks from docs/04 §5 exist for: outage announcement, add/remove service, restore, revoke
  admin.
- Staging Compose stack against the staging realm; pilot with the admin group; GA.

### Post-launch backlog (small production iterations, rough order)
1. **#42** PWA update notification ("new version — reload") — cheap, and it tightens the
   iterate-in-production loop; the install hint half already exists.
2. **#45 + #53** assistant widget rework (largely eule-side; re-enable when it earns it).
3. **#34** experimental-services opt-in, then **#36** group-scoped categories (design them
   together — both are "visibility beyond the three roles").
4. **#54** step-up auth (LoA) for the admin console.
5. From `notes`: search improvements (keywords UX, semantic search idea), favorites ordering
   in admin, notifications concept.

## Handoff prompt for the M1 coding session

> Read `CLAUDE.md`, `docs/specs/responsive-viewport-testing.md`, and GitHub issues #23, #33,
> #35 (virtUOS/wolke). Implement **PR 1 (harness + smoke)** of the viewport-testing spec
> exactly as specified: Playwright in `web-ui`, six fixed-viewport projects (324×756, 360×800,
> 390×844, 768×1024, 1280×720, 1920×1080), webServer = the embedded Go binary against local
> Postgres + the mock OIDC IdP, the overflow/readability/touch-target helpers with an
> auto-checking fixture, the dashboard smoke spec, the CI `e2e` job, and `make e2e`.
> Then add failing specs reproducing #23 (header overflow at 324×756), #33 (bottom empty
> space on mobile), and #35 (mobile-hidden elements still exposed to screen readers — assert
> via the accessibility tree). Mark them `test.fixme` with issue links so the harness PR
> merges green, then fix each issue in its own follow-up PR, flipping its test live.
> Spec → tests → code; small PRs; no Claude attribution in commits.
>
> **Run with: opus, new session off `main`.** Keep the same session for the #23/#33/#35
> follow-up PRs (the harness context pays off there).

### Model/session routing for later milestones
- **M2 UX bug batch:** sonnet, new session (small, well-specced, independent fixes).
- **M3 back-channel logout + security review:** fable, new session (security-critical OIDC
  work; the review runs in the same session after the implementation lands).
- **M4 launch prep:** mostly supervisor + manual config; sonnet for runbook drafting if needed.

## Status tracking

GitHub milestones mirror M1–M3 + Post-launch; issues are assigned accordingly. The supervisor
session keeps this file current as milestones close.
