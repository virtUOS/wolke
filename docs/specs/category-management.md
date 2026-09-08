# Spec — category management: edit, delete, reorder (issue #130)

Status: **implemented** · Issue: **#130** · Post-launch · Written 2026-09-08

## 1. What existed, what was missing

`CategoriesAdmin.tsx` was a read-only list plus a create form, backed by the one
write path `POST /api/admin/categories` → `service.CreateCategory`. The store had
`CreateCategory` / `GetCategoryBySlug` / `ListCategories` / `CountCategories` and
nothing else. Consequences:

- a typo in a label was permanent without DB access;
- `categories.sort` was written once at creation (`max(sort)+10` from the
  frontend), so the order categories appear in for **every** user could never be
  changed;
- the slug format regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` lived **only** in
  `CategoriesAdmin.tsx`. `CreateCategory` checked non-empty and nothing else, so
  the API accepted `"Foo Bar!!"` — a rule-3 violation (validation belongs in
  `/internal/service`).

**No schema change is needed, confirmed against `migrations/00001_init.sql`:**
`categories(id uuid pk, slug text unique not null, label jsonb not null,
sort integer not null default 0)` already carries slug, both labels and the
order, and `service_categories.category_id references categories(id) on delete
restrict` already provides the delete guard.

## 2. Design

### 2.1 Slug validation moves server-side

`^[a-z0-9]+(?:-[a-z0-9]+)*$`, enforced in `/internal/service` for **both** create
and update. The frontend keeps its identical check as the fast-feedback path
(`aria-invalid` + an inline hint), not as the enforcement point.

Empty and badly-formatted slugs are distinct messages, both
`ValidationError{Field: "slug"}` → 400.

### 2.2 Renaming a slug is allowed

`service_categories` joins on the category **id**, so attachments survive a
rename untouched. The only slug consumer is the `/?cat=<slug>` URL filter, and
`Dashboard.tsx` already drops a filter slug the catalog no longer knows — a stale
bookmark degrades to "no filter", which is the accepted cost (deep-linking into
the dashboard is not a real use case).

`categories.slug` is `unique not null`, so renaming onto an existing slug is
checked in the service layer and returned as
`ValidationError{Field: "slug", Msg: "already exists"}` → 400. A raw
`23505` constraint violation must never reach the client; create takes the same
check, so both write paths behave identically.

Note for operators: `local-archive/bootstrap/services.yaml` maps services onto
category slugs, so a rename invalidates a *re-run* of that one-off loader. Worth
knowing; not a constraint on the design.

### 2.3 Delete is guarded, not cascading

The FK's `on delete restrict` is the correct guard: `internal/service/admin.go`
requires every service to carry ≥ 1 category, so cascading would mint invalid
services. `DeleteCategory` therefore counts the attached services **before**
deleting and refuses with a message naming the count and the first few service
names:

> `3 services still use this category: BigBlueButton, Stud.IP, Webmail. Reassign them first.`

This is a `ConflictError` → **409**, not a validation error: the input was
well-formed, the state refuses it. The count is of `service_categories` rows
regardless of `is_active` — a soft-deleted service keeps its row and keeps
blocking the FK, so counting only active ones would promise a delete that then
fails.

### 2.4 Reorder is a whole-list write

`PUT /api/admin/categories/order` with the ordered slugs, validated in the
service layer as a **permutation of exactly the existing slugs** (no duplicates,
nothing missing, nothing unknown) — the same shape and rationale as
`PUT /api/favorites/order`: a client and the server can never end up with two
notions of the order, and sending the same list twice is a no-op. The write
renumbers `sort` to `(ordinal - 1) * 10` in one statement, keeping the gap-style
values create's `max(sort)+10` appends after.

### 2.5 Audit and cache

All three writes go through `/internal/service`, run in one transaction with
their audit row, and follow `category.create`'s pattern:
`category.update` / `category.delete` / `category.reorder`, each with a
before/after diff. Each route calls `d.invalidate()` on success — labels and
order are part of the `/api/catalog` payload.

### 2.6 UI

`CategoriesAdmin.tsx` rows gain, per row: ▲ / ▼, Bearbeiten, Löschen.

- **No drag & drop**, consistent with the admin role-defaults editor and the
  favourites *Anordnen* mode (#125) and their a11y rationale. Every move writes
  the whole list through immediately (no draft order to reconcile) and is
  announced in a polite live region, as `FavoritesArrange` does.
- **Edit** reuses the create form's three fields (slug, label de, label en) in
  place, switched into edit mode with the row's values; focus moves to the slug
  input, and Abbrechen returns it to the row's edit button.
- **Delete** goes behind the shared confirm `Dialog`. The "still in use" refusal
  is rendered as a readable `role="alert"` message in the section, not a toast of
  a raw error.
- New controls are `IconButton`/`Button` primitives, so they inherit the 44px
  phone touch floor. The new states (edit form, confirm dialog, reorder row
  actions) join `e2e/admin-viewport.spec.ts` across the full matrix.

### 2.7 Out of scope

**MCP parity**, consistent with create, which is not MCP-exposed either (the
admin MCP has `category.list` read-only; productionisation is deprioritised,
#90). No schema change.

## 3. Acceptance

- Editing labels updates both languages and shows in the catalog immediately;
  missing `de`/`en` is rejected as create rejects it.
- A malformed slug (`"Foo Bar!!"`) is rejected by the **API**, on create and on
  update.
- Renaming onto an existing slug returns a field-level error, not a 500.
- Deleting an unused category works behind a confirm; deleting one still in use
  is refused with the blocking count — no raw constraint error, no orphaned
  service.
- Reordering persists, changes the order users see, and is permutation-checked.
- All three actions land in the audit log with before/after diffs.
- Full gates incl. `make e2e` across the viewport matrix.
