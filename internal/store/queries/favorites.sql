-- name: ListFavoriteServiceIDs :many
select service_id from favorites where user_id = @user_id order by sort, created_at;

-- name: NextFavoriteSort :one
select coalesce(max(sort) + 1, 0)::int from favorites where user_id = @user_id;

-- name: AddFavorite :exec
insert into favorites (user_id, service_id, sort)
values (@user_id, @service_id, @sort)
on conflict (user_id, service_id) do nothing;

-- name: RemoveFavorite :execrows
delete from favorites where user_id = @user_id and service_id = @service_id;
