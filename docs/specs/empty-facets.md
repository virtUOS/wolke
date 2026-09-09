# Spec — Don't offer a filter that leads to an empty view (issue #139)

Status: accepted 2026-09-09. Small, three edits. Amends
`docs/specs/service-visibility.md` §3 and §6 (see §5 below).

## 1. The rule

A filter control is offered **only when it selects at least one service the
reader can see**. Three places break that rule today, and all three produce the
same defect: a pill that looks like navigation, answers with an empty page, and
teaches the user that the strip is unreliable.

| Control | Today | After |
| --- | --- | --- |
| A category pill | rendered whenever the category exists and was never populated for anyone | rendered only when ≥ 1 visible service is in it |
| "In Wartung" | rendered unconditionally | rendered only when ≥ 1 visible service is tagged `wartung` |
| "Beta" | rendered whenever `show_beta` is on | rendered when `show_beta` is on **and** ≥ 1 visible service is tagged `beta` |

"Visible" always means *narrowed for this reader* — the same predicate as
`docs/specs/service-visibility.md` §3. Nothing about that predicate changes; the
rule here is about which **categories** survive it, and about two client-side
counts.

## 2. The server side: category narrowing

`catalog.Snapshot.narrow` currently keeps a category that no service anywhere is
filed under, and drops only a category that *narrowing* emptied:

```go
if !populated[c.Slug] || stillPopulated[c.Slug] { … }
```

That asymmetry was deliberate in the v2 work: it kept an unconfigured
deployment's `/api/catalog` payload byte-identical to the raw catalog, so the
plain deployment demonstrably paid nothing for the visibility feature. It also
means an empty category leaks into every dashboard as a dead pill.

**This spec reverses it.** The condition becomes `stillPopulated[c.Slug]` — "has
at least one visible service", the same test for every reader and every reason a
category can be empty (never populated, all services soft-deleted, all beta and
the reader did not opt in, all in a restricted category they do not hold).

Consequences, accepted:

- The prebuilt `public` view is no longer literally the raw catalog when a
  deployment has an unused category, so `NewSnapshot`'s "nothing to narrow" fast
  path must narrow whenever an empty category exists. It still builds **one**
  view, once, and still hands it out without copying — the cost is a single
  assembly at load time, not per request.
- The v2 regression test `TestUnrestrictedCatalogIsByteIdentical` pins the old
  behaviour and is **updated deliberately**, not deleted: it keeps guarding the
  no-copy property and the identical *service* list, and its comment records that
  the empty-category half of the old contract was reversed here and why.

### 2.1 Why this is safe for admins

The admin screens read `GET /api/admin/categories` and `GET /api/admin/services`
— unnarrowed, since `docs/specs/service-visibility.md` §5. An empty category
therefore stays listed, editable, reorderable and deletable in Administration.
Only the reader-facing catalog hides it.

### 2.2 The consequence worth documenting

A **freshly created category does not appear in the dashboard until a service
uses it.** Correct under the rule above, and surprising the first time. It goes
in `docs/runbooks/manage-service.md` beside the category management steps.

## 3. The client side: the two facets

`Dashboard.tsx` gates the two tag facets on their counts over the *already
narrowed* catalog it holds:

- "In Wartung" — `maintenanceCount > 0`. The comment claiming it is "always
  shown so maintenance is reachable as a facet" goes with it.
- "Beta" — `me.show_beta && betaCount > 0`.

Both counts are computed from `/api/catalog`, so they are the reader's counts,
not the deployment's.

### 3.1 Stale filters self-correct

A filter whose control just disappeared must not leave the page headed by a
facet with no tiles and no active pill — the correction the Beta facet already
makes when `show_beta` goes off. The render-time guards in `Dashboard.tsx` are
therefore extended to the counts, in the same adjust-during-render style and
with the same `replace()` (no history entry):

- `?cat=<slug>` for a category the narrowed catalog no longer carries → "Alle".
  **Already implemented**; this spec only relies on it. An emptied category is
  now simply absent from `catalog.categories`, which is exactly the case that
  guard was written for.
- `?filter=maintenance` with `maintenanceCount === 0` → "Alle".
- `?filter=beta` with `show_beta` off **or** `betaCount === 0` → "Alle".

Each count guard waits for `catalog.data`: during the first load every count is
0, and correcting then would wipe a legitimate deep link.

## 4. Definition of done

- `narrow` drops every category with no visible service; the v2 regression test
  is updated with a comment saying the rule changed and why.
- Go unit coverage for each way a category can be empty: never populated, all
  services beta with the pref off, all in an unheld restricted category.
- "In Wartung" and "Beta" appear only with a matching visible service; unit
  coverage for both, plus the stale-filter corrections.
- e2e viewport coverage of the pill strip in both states — facets present and
  facets absent — across the full matrix.
- Admin category management demonstrably unchanged (already covered by
  `admin-categories.spec.ts`, which reads the unnarrowed endpoint).
- `docs/runbooks/manage-service.md` records §2.2.

## 5. Amendments to `docs/specs/service-visibility.md`

- §3 "Category narrowing — now the *primary* filter rather than a derived one"
  still holds; the sentence in the code doc-comment that a category empty for
  everyone "stays, exactly as today" does not, and is replaced.
- §6's first bullet ("no restricted category and no beta service → behaviour
  identical to today") is narrowed to the services list and the no-copy
  property. An unused category is the one intended difference.
