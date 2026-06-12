-- name: ListFavoritesByUsage :many
-- Favorites ordered by the user's click count (most-used first), then by the
-- stored order as a stable tiebreaker.
select f.service_id
from favorites f
left join (
    select click_events.service_id, count(*) as c
    from click_events
    where click_events.user_id = @user_id
    group by click_events.service_id
) cc on cc.service_id = f.service_id
where f.user_id = @user_id
order by coalesce(cc.c, 0) desc, f.sort, f.created_at;

-- name: ListFavoritesAlpha :many
-- Favorites ordered alphabetically by service name.
select f.service_id
from favorites f
join services s on s.id = f.service_id
where f.user_id = @user_id
order by s.name;

-- name: NextFavoriteSort :one
select coalesce(max(sort) + 1, 0)::int from favorites where user_id = @user_id;

-- name: AddFavorite :exec
insert into favorites (user_id, service_id, sort)
values (@user_id, @service_id, @sort)
on conflict (user_id, service_id) do nothing;

-- name: RemoveFavorite :execrows
delete from favorites where user_id = @user_id and service_id = @service_id;

-- name: SeedFavoritesFromRoleDefaults :exec
-- One-time pre-fill: copy the user's role defaults into favorites as real,
-- editable entries (concept §4.4).
insert into favorites (user_id, service_id, sort)
select @user_id, rd.service_id, rd.sort
from role_defaults rd
join services s on s.id = rd.service_id
where rd.role = @role and s.is_active = true
on conflict (user_id, service_id) do nothing;

-- name: MarkFavoritesSeeded :exec
update users set favorites_seeded = true where id = @user_id;
