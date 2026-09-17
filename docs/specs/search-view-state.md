# Spec — Search, arrange mode, and the 768px crossing (issue #198)

Status: accepted 2026-09-17. Client-only; no API, no schema, no migration.
Amends nothing — it writes down rules `Dashboard.tsx` implied but never held.

Two interactions from the whole-branch review of `feat/launcher-v1.1`, both in
the #170/#171 seam (tabs moved into a row, search moved into the app bar). Each
PR was correct alone; the combination is not.

## 1. What the code actually does today

Worth stating precisely, because one of the two findings is larger than the
issue reported it as.

`arrangeRequested` is a plain `useState(false)` with exactly two writers: the
sort menu's *Anordnen* sets it, and *Fertig* / *Abbrechen* clear it. **Nothing
else ever touches it** — not `onTab`, not `clearSearch`, not `useViewHistory`'s
`onPop`. The mode is only *derived* down again:

```ts
const arranging = arrangeRequested && me.favorites_order === 'manual' && favCount > 0
```

That derivation is guarded on the favorites *order* and the favorites *count*,
but not on the favorites *tab*. So the flag survives a navigation, and because
the tab row is suppressed by `{!arranging && <LauncherTabs …>}` regardless of
which tab is showing, arrange mode leaks out of the view it belongs to:

- **Reported:** type a query while arranging → the tab row, the results heading
  and the `Abbrechen · Anordnen · Fertig` bar unmount together; clear the query
  → you are back in arrange.
- **Not reported, same state:** start arranging on Favoriten, then reach the
  Dienste tab by a route that isn't the (hidden) tab row — Back, or the
  greeting's "*n* Dienste in Wartung" shortcut. The Dienste list renders with
  **no tab row and no arrange bar**: the only way back to Favoriten is Back
  again. Nothing about that is visible to the user as a mode.

So "check what `arrangeRequested` does on navigate" has an answer, and it is
not one line: it does nothing, and the derivation that should have caught it is
missing its tab guard. §2 fixes both halves.

`searchOpen` is the phone overlay's flag. A desktop keeps the state — `⌘K`
sets it through the shared `openSearch` — but renders nothing from it, and
`query` is shared by both layouts outright. §3.

## 2. Rule A — a search cancels arrange; arrange belongs to Favoriten

**Decision: starting a search cancels arrange mode.** Not "arrange suppresses
the search entry points".

This is the consistent answer, not merely the cheaper one. *A search resets the
view* is already the established rule in this file: switching tabs cancels a
search (`onTab` → `clearSearch`), a popstate cancels a search (`onPop`), a
plain-click launch cancels a search (#26/#27), and a search clears the active
filter (`onSearch` → `replace`). Search is the view that overrides every other
view; arrange is one more view for it to override. The alternative — hiding the
app-bar field, the phone pill and both hotkeys whenever Anordnen is open —
takes the launcher's one global affordance away from a reader who is standing
in a modal-ish edit screen, which is when they are most likely to want out.

Two edits, one per half of §1:

1. **`onSearch` clears `arrangeRequested` when a query starts.** Cancelling
   means the flag is *gone*, not masked: clearing the query afterwards lands on
   the ordinary Favoriten list, never back in the edit mode. The mode is
   re-entered the way it is entered — through the sort menu.
2. **`arranging` gains `tab === 'favoriten'`.** Arrange is an edit mode *of the
   favorites list*, so it is derived from the view that holds it rather than
   corrected in an effect — the same doctrine as the `favorites_order` and
   `favCount` guards already in that line, and the reason this needs no second
   piece of state to keep in sync. A popstate back onto Favoriten restores the
   mode, which is coherent: the flag and the view agree at every moment.

Invariants after this: the arrange bar and the search results never render at
once; the tab row is absent only on the Favoriten tab, and only with the
arrange bar in its place.

## 3. Rule B — a layout crossing carries the query and reconciles `searchOpen`

**Decision: the query carries across; `searchOpen` is reconciled, not carried.**

Losing typed text on a rotate is the worse failure — the user did not ask for a
layout change, the device did, and a query is the most expensive state on the
screen. The actual bug is narrower than "shared state": it is that `searchOpen`
survives into a layout that never renders it. Three edits:

1. **`openSearch` sets the flag only on a phone.** On a desktop the field is
   already in the bar, so `⌘K` is a plain focus. Setting the phone's flag from
   the desktop is literally the reported defect: narrow the window later and the
   full-bar overlay pops unbidden, `aria-expanded="true"`.
2. **A crossing of the breakpoint clears `searchOpen`.** Adjusted during
   render (the repo's adjust-during-render pattern, as the view invariants
   above it use — the lint rule forbids sync `setState` in effects). Nothing
   about the phone overlay outlives the phone layout, in either direction.
3. **The phone overlay is open when the flag is set *or* a query is active:**

   ```ts
   const phoneSearchOpen = isMobile && (searchOpen || searching)
   ```

   This is what makes carrying the query safe. A query typed in the desktop bar
   and carried into the phone layout by a resize arrives with the field visible
   and its ✕ reachable, instead of filtering the list from a control that isn't
   on screen. It is also the one derivation both consumers use — the
   `GlobalSearch` `open` prop and the `DashboardShell` `searchOpen` prop, which
   is what makes the bar's other actions inert underneath it.

`query` itself is untouched by the crossing.

## 4. Tests

- **Component** (`search-view-state.test.tsx`): a query started during arrange
  cancels it and clearing the query does not restore it; the arrange bar and
  the search results never co-render; navigating away while arranging brings
  the tab row back (§1's unreported half); crossing the breakpoint with a
  query, and with `searchOpen` set, leaves coherent state in the destination
  layout, in both directions. The existing `matchMedia` stubs in this suite are
  static, so this file brings a controllable one that actually dispatches
  `change` to `useIsMobile`'s listener.
- **e2e** (`issue-198-search-arrange.spec.ts`): the matrix already runs both
  layouts, so what it adds is the *crossing* — each project resizes to the
  other side of 768px and back, asserting the destination state and the
  viewport health of every stop, and ends at its own matrix viewport so the
  auto-guard in `fixtures.ts` still checks the size the project stands for.
