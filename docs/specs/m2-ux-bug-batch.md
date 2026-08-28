# Spec — M2: UX bug batch (#31, #30, #28, #27)

Status: **ready to implement** · Owner: supervisor session · Written 2026-08-28
Milestone: **M2** of `docs/specs/production-roadmap.md`. Predecessor M1 (viewport harness +
mobile fixes) is closed; the Playwright harness in `web-ui/e2e/` is the baseline this builds on.

Four independent fixes, **one small PR each**, spec → tests → code, off `main`. Every PR that
touches a screen extends the e2e viewport suite in the same PR
(`docs/specs/responsive-viewport-testing.md` §6, all six viewport projects).

## 0. Ground rules for the whole batch

- **Test first.** Write the failing test (Vitest for logic/markup, Playwright for a screen or an
  intermediate state), watch it fail, then fix.
- **No Claude attribution in commits** (CLAUDE.md → "Commits and CI"). No `Co-Authored-By`, no
  "Generated with", nothing.
- **Definition of done per PR:** `go test -race ./...` (unchanged here, but keep it green),
  `npm run lint`, `tsc --noEmit`, `npm test`, `make e2e` green across the full matrix, and the
  embedded build (`web-ui` dist → `internal/web/dist`) committed as the repo already does it.
- **The viewport fixture auto-checks the final state of every test.** Intermediate states (menu
  open, results panel open) must call the helpers explicitly — see `e2e/fixtures.ts` and
  `expectViewportHealthy` in `e2e/helpers/viewport.ts`.
- **Known landmine:** the account-menu rows and the language pills inside the panel are ~27–33px
  tall. The moment a spec opens that panel on a phone, `expectTouchTargets` fails. That is
  expected and in scope — see PR 3.

## PR 1 — #31 · Category filter reset on section navigation

**Read the prior art first, then discard it.** Branch `fix/mobile-filter-reset` (commit `f0194d5`,
2026-07-17) has no merge base with `main` (history rewrite) and its fix — reset the filter when
entering the mobile layout — **already lives on main**, reimplemented as a render-time view
invariant in `Dashboard.tsx` ("Mobile has no filter controls…"). It also carries a
`Co-Authored-By: Claude` trailer. Do not cherry-pick it; delete the local branch when done.

**Likely finding: the bug is already fixed.** Issue #31 was filed 2026-07-04. On 2026-07-17 the
back-navigation work (`873f054`, issue #29) rewrote tab switching as:

```ts
onTab: (next: Tab) => {
  setQuery('')
  navigate({ tab: next, filter: { kind: 'all' }, admin: false })
}
```

— which resets the filter both when leaving Services and when re-clicking the already-active
Services tab (the reporter asked for both). So the job here is **verification + a regression
test**, not a rewrite.

**Do:**
1. Add a Playwright spec (extend `e2e/dashboard.spec.ts`, desktop-relevant but it runs at all six
   projects; the filter pills are desktop-only, so guard the pill interaction on
   `test.skip(project.use.isMobile === true)` or drive it via the `?filter=` deep link so the
   mobile projects still assert the reset). Cover both reported paths:
   - Services → pick a category pill → Favoriten → Dienste ⇒ heading is "Alle Dienste", URL has
     no `filter=`, the full catalog is listed.
   - Services → pick a category pill → click **Dienste** again ⇒ same reset.
2. Add a Vitest unit assertion for the `onTab` contract if it isn't covered (`view-history` tests
   exist; the Dashboard-level handler is not).
3. Run it. **If it passes on main**, also reproduce the video's exact steps by hand
   (`make run`, desktop + phone emulation) to be sure nothing subtler was meant, then close #31
   as already fixed by #29, with the regression test as the PR's content and a comment on the
   issue explaining which commit fixed it.
4. **If it fails**, fix in `Dashboard.tsx` only — keep the "one place decides the view" shape;
   don't add a second reset path.

Deliberately **not** changed: Back/Forward restoring a filtered view (that is #29's contract), and
entering/leaving Admin (`onAdmin` keeps the view).

## PR 2 — #30 · `cursor: pointer` on the section tabs

The tabs are `PillButton`s (`web-ui/src/components/ui/pill-button.tsx`); `<button>` defaults to
`cursor: default`. The reporter's point — they navigate like links — applies to every pill used as
a control, and the account menu's own rows already set `cursor: pointer` inline.

**Do:** add `cursor-pointer` to the `pillButtonVariants` base classes (one line), so tabs, the
category filter pills and the view-mode switches all agree. Check the rest of the interactive
chrome while there: any `<button>` or `[role="button"]` still on the default cursor in `TopBar`,
`NotificationBell`, `Tile` and the admin surface gets `cursor-pointer` too — but keep it to
genuinely clickable controls (`cursor: default` stays on disabled buttons; the language group's
non-interactive label wrapper stays `default`).

**Tests:** extend `src/__tests__/ui-primitives.test.ts` — the rendered pill carries
`cursor-pointer`, and a disabled one does not get a pointer cursor. No layout change, so **no new
e2e spec** is required; the existing suite must stay green.

## PR 3 — #28 · Explicit "Auto" in the theme menu + the account-menu touch targets

Two things, same PR, because the second is what the new e2e coverage exposes.

### 3a. Theme: toggle → three-way group

Today the account menu has a single toggle button ("Dunkles Design aktivieren") derived from
`isDark`; the language switcher right below it is a three-button `auto | de | en` group. Make
theme match it exactly: **Automatisch | Hell | Dunkel**, backed by `Me['theme']` which the API
already models as `'light' | 'dark' | 'system'` (`web-ui/src/lib/api.ts`, `usePrefsMutation`,
`useApplyTheme` — all three already handle `'system'`). **UI-only; no backend, no migration.**

- `TopBar.tsx`: replace the `isDark` / `onToggleTheme` props on `AccountMenu` (and on `TopBar` and
  `DashboardShell`) with `theme: Me['theme']` + `onSetTheme(next: Me['theme'])`. Render the group
  with the same markup, `aria-pressed`, wrapping and label pattern as the language group —
  labelled `s.topbar.theme` with a `Sun`/`Moon`-style icon, `role="group"`.
- `Dashboard.tsx`: `onSetTheme: (next) => prefs.mutate({ theme: next })`. Keep the derived
  `isDark` where it is still needed (`DashboardShell`'s background, the assistant widget).
- `lib/i18n.ts`: new strings in both `de` and `en` — `theme` ("Farbschema" / "Colour scheme"),
  `themeAuto` ("Automatisch" / "Automatic"), `themeLight` ("Hell" / "Light"), `themeDark`
  ("Dunkel" / "Dark"). Remove `toLight`/`toDark` once nothing references them. Watch the German
  compound width inside the 244px panel — the group wraps, it does not force three columns.
- `src/__tests__/TopBar.test.tsx` / `i18n.test.ts`: the group renders three options, the active
  one is `aria-pressed`, each click calls `onSetTheme` with `system`/`light`/`dark`, and
  `system` follows `prefers-color-scheme` (already covered by `useApplyTheme` — extend if not).

### 3b. Viewport coverage of the open account menu, and the touch targets it exposes

New `e2e/account-menu.spec.ts` (spec §6 flow 6): open the avatar menu, assert it is visible, call
`expectViewportHealthy` **while it is open** (intermediate state → explicit call), switch the
language to `en` and re-check, then close with Escape and let the fixture check the final state.

On the phone projects this will fail `expectTouchTargets`: the menu rows (`itemStyle`, ~33px) and
the language pills (~27px) are below 44px. Fix them in this PR — `min-h-11` on the rows and on
every pill in both groups at the mobile breakpoint, collapsing to the compact size from `md` up
(the same pattern the avatar button and the bell already use). Re-check the 244px panel at 324×756
afterwards: taller rows must not push the panel past the viewport or clip the last item — make the
panel scroll (`max-h` + `overflow-y-auto`) if it does.

While the panel is open, also check the notification panel (`NotificationBell`) if any spec opens
it; its rows are non-interactive `<li>`s today, so they should not trip the check — if they do,
fix them here rather than filing.

## PR 4 — #27 · Launching from search results clears the search

Decision on #26 stands: **services open in a new tab**. So returning to wolke with a stale search
is real. Clear the search when the user launches a service **from search results** by an ordinary
left click.

- `Dashboard.tsx`, `actions.onLaunch`: after `api.recordClick(...)`, if `searching` is true, clear
  it — `setQuery('')`. That drops the app back to the tab/filter view the user was on (the view
  state is untouched, so no history entry is needed; use `replace` only if a filter invariant
  demands it).
- **Don't clear on a deliberate new-tab gesture** — the reporter is explicit. `Tile`'s launch links
  already pass through `onClick`; middle-click fires `auxclick`, not `click`, so it is free, but
  `Ctrl`/`Cmd`/`Shift`-click does reach `onClick`. Pass the modifier state through (or check the
  event in `Tile`) and skip the reset when any of `ctrlKey`, `metaKey`, `shiftKey` is set or
  `button !== 0`. Documentation links (`target: 'documentation'`) do **not** clear the search.
- Click tracking must keep firing in every case — the reset is presentation only.

**Tests:**
- Vitest (`Tile.test.tsx` and a Dashboard-level test): plain click on a search result calls
  `onLaunch` and clears the query; `Ctrl`-click calls `onLaunch` and leaves it; the doc link
  leaves it.
- New `e2e/search.spec.ts` (spec §6 flow 3, all six viewports): type a query with results →
  results panel open, `expectViewportHealthy` on that intermediate state → click a result (the
  new tab: handle the popup with `context.waitForEvent('page')` or assert on the anchor's
  `target="_blank"` and click with the popup awaited) → the search box is empty and the previous
  view is back. Second test: a zero-result query renders the empty state, checked at every
  viewport.

## Order, sequencing and exit

PRs are independent; land them in the order above (1 and 2 are near-trivial, 4 is the largest).
PR 3 and PR 4 both add e2e specs — rebase the second one on `main` after the first merges so the
suite runtime stays honest.

**Exit criteria:** #31, #30, #28, #27 closed; `e2e/search.spec.ts` and `e2e/account-menu.spec.ts`
exist and are green at all six viewports; no sub-44px interactive target remains in the account
menu; M2 milestone closed and `production-roadmap.md` updated by the supervisor session.

**Run with: sonnet, new session off `main`** — one session for all four PRs (shared harness
context). Escalate to opus only if PR 3's prop rewiring or PR 4's popup handling turns out to
fight the existing structure.

## Handoff prompt for the M2 coding session

> Read `CLAUDE.md`, `docs/specs/m2-ux-bug-batch.md` (this file — it is the full brief),
> `docs/specs/responsive-viewport-testing.md` §6/§8, and GitHub issues #31, #30, #28, #27
> (virtUOS/wolke). Implement the four PRs in the order given there, **one small PR each off
> `main`**, spec → tests → code: PR 1 #31 (regression spec first — the bug is probably already
> fixed by `873f054`; verify, then close the issue with the test as the PR), PR 2 #30
> (`cursor-pointer` on `pillButtonVariants` + the rest of the interactive chrome), PR 3 #28
> (theme toggle → an `Automatisch | Hell | Dunkel` group mirroring the language switcher, UI-only;
> plus `e2e/account-menu.spec.ts` and the sub-44px account-menu rows and language pills it
> exposes), PR 4 #27 (clear the search when a service is launched from a result by a plain left
> click — not on Ctrl/Cmd/Shift/middle click, not on doc links; plus `e2e/search.spec.ts` for the
> open results panel and the zero-result empty state).
>
> Do not cherry-pick `fix/mobile-filter-reset` — it has no merge base with `main`, its fix is
> already on `main` as a render-time view invariant, and it carries a Claude co-author trailer.
>
> Every PR that touches a screen adds its state to the e2e viewport suite in the same PR, green at
> all six viewport projects. Per-PR done: `npm run lint`, `tsc --noEmit`, `npm test`,
> `go test -race ./...`, `make e2e`, embedded build committed. **No Claude attribution in commits.**
>
> **Run with: sonnet, new session off `main`.** Keep the same session for all four PRs; escalate to
> opus only if PR 3's prop rewiring or PR 4's popup handling fights the existing structure.
