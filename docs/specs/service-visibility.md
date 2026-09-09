# Spec — Service visibility, v2: the beta tag and restricted categories

Status: **IMPLEMENTED** (PR #134, 2026-09-08) — awaiting review and human testing against a real
IdP. Supersedes the v1 design, whose Stage 1 shipped in PR #131 (2026-09-08) and was judged
unshippable on UX grounds before any deployment configured it.
Owner: supervisor session · Rewritten 2026-09-08, implemented 2026-09-08
Issues: **#34** (experimental mode, reopened), **#121** (restricted groups), **#36** (subsumed).

## 1. What was wrong with v1

v1 invented a configurable *visibility slug* per service, with two grant types and its own badge.
Three things followed, all bad:

- **It duplicated a concept the product already had.** `services.tag = 'beta'` already means "early
  software" and already renders a badge. v1 added an `experimental` slug next to it, so an admin
  set a tag *and* a visibility, and a tile could render `[Beta] [Experimentell]` — two badges for
  one idea that no user distinguishes.
- **It made experimental services leave their category.** They belong in `ai-tools` or wherever
  they actually belong; "experimental" is a property of the service, not a place in the catalog.
- **It required config for something that needs none.** Turning on experimental services meant
  editing `config.yaml`, restarting, then marking services — for a concept the schema already
  carried.

And it shipped a real defect: the admin screens read the **narrowed** `/api/catalog`, so an admin
who does not hold a group cannot see or manage its category or services (§5).

## 2. The model

Two distinct needs, each expressed with the smallest thing that already exists.

### 2.1 Experimental = the `beta` tag, and nothing else

`services.tag = 'beta'` becomes the single flag. It already renders the Beta badge; it now also
means **hidden unless the user asks for them**:

- A boolean user pref (`users.show_beta`, sibling of `favorites_separate_tab`) reveals them,
  behind a confirm dialog carrying a **built-in** warning — data may vanish, nothing is migrated
  (i18n strings, not config; the stakeholder requirement from #34 survives, its configurability
  does not).
- Revealed services appear inline **in their own categories**, badged Beta exactly as today.
- A **Beta filter** appears beside the existing maintenance filter, and only while the pref is on.
  It is a direct parallel of what exists: `filter: {kind:'maintenance'}` counted from
  `s.tag === 'wartung'` (`Dashboard.tsx`).
- Admin sets one field: the tag. No config, no category, no visibility.

`wartung` keeps its present meaning — cosmetic label plus its filter. Only `beta` gains the
hiding semantics; the asymmetry is deliberate and documented.

### 2.2 Restricted groups = a restricted category

Visibility moves **from the service to the category**. Assigning a service to
"IT-Infrastruktur" *is* restricting it:

- `categories.visibility text NULL` — NULL = public (today's behaviour), a slug = only holders of
  that slug see the category **and everything in it**.
- Set once, in the category editor from #132. The service form shows **at most a hint** ("in
  IT-Infrastruktur — visible only to that group"), never a control of its own.
- Non-holders see neither the category (no filter pill) nor its services, anywhere.
- Config keeps only the **claim mapping** — slug, label, claim, match — because there is no way to
  guess which IdP group grants membership. `grant:` and `warning:` disappear; there are no
  opt-in entries in config at all.

**Restricted wins (decided 2026-09-08).** A service in several categories is visible only if the
user holds *every* restricted category it belongs to. The alternative — visible via any public
category — would make restriction bypassable by filing the service under a second category.

## 3. What survives from v1

The expensive half is unchanged, because only the *predicate* moves:

- `catalog.Snapshot`'s unexported fields and `VisibleTo(held) *View` as the sole readable type —
  a handler that forgets to narrow still fails to compile.
- Every read surface already wired: catalog, defaults, search, favourites, frequent, the click
  metric, and the always-public catalog MCP.
- The no-oracle write paths (unknown and restricted ids share one no-op response).
- Category narrowing — now the *primary* filter rather than a derived one.
- `users.visibility_claims` and the claim resolver from PR #134: claims → held slugs is
  unchanged in substance.

The new predicate:

```
visible(service, user) =
      every restricted category of the service is held by the user   // §2.2, restricted wins
  AND (service.tag != 'beta' OR user.show_beta)                       // §2.1
```

## 4. What changes

- **Migration**: add `categories.visibility text`, add `users.show_beta boolean not null default
  false`; **drop** `services.visibility` and `users.visibility_optin`. Safe: no deployment has
  ever configured visibility, and the production catalog has no beta-tagged service, so no data
  depends on either column.
- **Config**: `visibility:` entries lose `grant` and `warning`, keep slug/label/claim/match.
- **API**: `PUT /api/me/visibility` disappears; `show_beta` joins `PATCH /api/me/prefs`.
  `/api/me` reports `show_beta` and the held group slugs.
- **UI**: the v1 opt-in switch becomes one built-in "Beta-Dienste anzeigen" toggle; the v1
  visibility badge disappears (the tag badge was always the right one); the service form's
  visibility chips become the category hint; the category editor gains the visibility selector.
- **MCP**: the admin `visibility` field moves from service propose to category management; the
  read-only `visibility.list` reflects configured groups.

## 5. The admin-narrowing fix (defect, ship with this)

`AdminView` feeds the admin screens from `useCatalog()` → the narrowed `/api/catalog`, so an
admin who does not hold a group cannot manage its category or services. Admin surfaces must read
**unnarrowed** data: `GET /api/admin/services` already exists; add `GET /api/admin/categories`
(all categories with their visibility) and point the admin screens at both. `/api/catalog` itself
stays narrowed for everyone — an admin is still an ordinary user in their own dashboard.

## 6. Definition of done

Review round 1 (2026-09-09) found eight issues, all fixed on the branch. The one that mattered:
`/api/favorites` is narrowed but the order write validated against the unnarrowed set, so a
favorite that went invisible — a beta service after the pref went off, or one in a category whose
group was revoked — 400'd every reorder with no way out. The write now validates against the same
view the client is rendered from, and an invisible favorite keeps its stored `manual_sort`
untouched: neither required in the list nor written by it, so it slots back in where it was.

All met by PR #134 except one deliberate omission: **the MCP has no category write path** to move
the `visibility` field onto. `category.list` reports each category's group and `visibility.list`
lists the configured ones, and the field is gone from `service.propose_*` — but category
create/update/delete/reorder have been form-only since #130, so there is nothing there to extend.
Adding staged category writes to the MCP is a separate change (it needs a second `Preview` shape
in `internal/adminmcp`) and is not in the §4 list.


- No restricted category and no beta service → behaviour identical to today (regression test).
- A beta service is invisible until the pref is on; then it appears in its own categories, badged,
  and the Beta filter appears. Turning the pref off hides them again.
- A service in a restricted category is absent from catalog, defaults, search, favourites,
  frequent and the catalog MCP for non-holders; its category renders for nobody else.
- A service in a restricted *and* a public category is hidden from non-holders (restricted wins).
- An admin who holds no group can still see, edit and reorder every category and service in the
  admin screens.
- Docs: concept §5, technical spec §4/§6/§8/§9/§12, `config.example.yaml`, Keycloak guide,
  `docs/runbooks/grant-visibility-group.md`, README.
- Full gates incl. the viewport matrix for the toggle, the filter and the category editor.

## 7. Effort

**1–1.5 sessions.** The seam, the read surfaces and the claim resolver are done; this reworks the
predicate, moves one column, swaps one pref, simplifies three UI surfaces and fixes the admin
read. The Beta filter is a copy of the maintenance filter.
