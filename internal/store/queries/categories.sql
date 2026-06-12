-- name: CountCategories :one
-- A trivial query used in Phase 0 to prove the sqlc -> pgx pipeline end-to-end.
-- Real catalog queries arrive in Phase 1.
select count(*) from categories;
