-- name: CountCategories :one
-- A trivial query used in Phase 0 to prove the sqlc -> pgx pipeline end-to-end.
-- Real catalog queries arrive in Phase 1.
select count(*) from categories;

-- name: ListCategorySlugs :many
-- The existing slug set, in current order — the reference a reorder write has to
-- be a permutation of (issue #130).
select slug from categories order by sort, slug;

-- name: UpdateCategory :one
-- Slug and both labels; renaming is safe because service_categories joins on the
-- category id (issue #130 §2.2). Uniqueness is checked in the service layer, so
-- a 23505 here means a concurrent insert took the slug first.
update categories set slug = @slug, label = @label where id = @id returning *;

-- name: DeleteCategory :execrows
-- Unguarded on purpose: service_categories.category_id is `on delete restrict`,
-- so the database refuses a category services still use. The service layer
-- checks first and turns that into a readable refusal (issue #130 §2.3); this
-- statement is the second lock.
delete from categories where id = @id;

-- name: CountCategoryServices :one
-- How many services block a delete. Counts every attachment row, active or
-- soft-deleted: a soft-deleted service keeps its row and keeps blocking the FK,
-- so counting only active ones would promise a delete that then fails.
select count(*) from service_categories where category_id = @category_id;

-- name: ListCategoryServiceNames :many
-- The first few blocking service names, to name them in the refusal.
select s.name
from service_categories sc
join services s on s.id = sc.service_id
where sc.category_id = @category_id
order by s.name
limit @lim;

-- name: SetCategoryOrder :execrows
-- Whole-list order write: one statement, so the renumbering is atomic. `with
-- ordinality` numbers the incoming slugs; the gap-style step of 10 keeps
-- create's `max(sort)+10` appending after the last row. A slug that is not a
-- category updates nothing — the service layer has already rejected that case.
update categories c
set sort = ((o.ord - 1) * 10)::int
from unnest(@slugs::text[]) with ordinality as o (slug, ord)
where c.slug = o.slug;
