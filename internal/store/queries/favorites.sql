-- name: GetFavoriteLists :many
select * from favorite_lists where user_id = $1 order by sort, created_at;

-- name: GetFavoriteItemsForUser :many
-- All items across the user's lists, to assemble lists+items in one round trip.
select fi.list_id, fi.service_id, fi.sort
from favorite_items fi
join favorite_lists fl on fl.id = fi.list_id
where fl.user_id = $1
order by fi.list_id, fi.sort, fi.created_at;

-- name: CountFavoriteLists :one
select count(*) from favorite_lists where user_id = $1;

-- name: CreateFavoriteList :one
insert into favorite_lists (user_id, name, sort, is_default)
values ($1, $2, $3, $4)
returning *;

-- name: GetFavoriteListForUser :one
select * from favorite_lists where id = $1 and user_id = $2;

-- name: GetDefaultList :one
select * from favorite_lists where user_id = $1 and is_default limit 1;

-- name: RenameFavoriteList :execrows
update favorite_lists set name = $3 where id = $1 and user_id = $2;

-- name: SetFavoriteListSort :execrows
update favorite_lists set sort = $3 where id = $1 and user_id = $2;

-- name: DeleteFavoriteList :execrows
delete from favorite_lists where id = $1 and user_id = $2;

-- name: NextItemSort :one
select coalesce(max(sort) + 1, 0)::int from favorite_items where list_id = $1;

-- name: AddFavoriteItem :exec
insert into favorite_items (list_id, service_id, sort)
values ($1, $2, $3)
on conflict (list_id, service_id) do nothing;

-- name: RemoveFavoriteItem :execrows
delete from favorite_items where list_id = $1 and service_id = $2;
