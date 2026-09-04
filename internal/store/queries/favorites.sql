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
-- manual_sort is computed here rather than passed in: a favorite starred while
-- the user is in manual mode has to land at the end of *their* arrangement,
-- which is a different sequence from `sort` (issue #125).
insert into favorites (user_id, service_id, sort, manual_sort)
values (
    @user_id, @service_id, @sort,
    (select coalesce(max(f.manual_sort) + 1, 0) from favorites f where f.user_id = @user_id)
)
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

-- name: ListFavoritesManual :many
-- Favorites in the order the user arranged them (favorites_order = 'manual').
-- created_at is the tiebreaker for rows that still share a manual_sort, which
-- is only the case before the one-time seeding below has run.
select f.service_id
from favorites f
where f.user_id = @user_id
order by f.manual_sort, f.created_at;

-- name: ListActiveFavoriteIDs :many
-- The favorites the API actually exposes: /api/favorites resolves ids through
-- the catalog snapshot, which holds active services only, so this is the set a
-- manual-order write has to be a permutation of. A favorite whose service was
-- soft-deleted keeps its row (and its sort) and simply isn't part of that set.
select f.service_id
from favorites f
join services s on s.id = f.service_id
where f.user_id = @user_id and s.is_active = true;

-- name: SetFavoritesOrder :execrows
-- Whole-list manual order write: one statement, so the renumbering is atomic
-- without a transaction. `with ordinality` numbers the incoming array, and the
-- join means an id that is not the caller's favorite updates nothing — the
-- service layer has already rejected that case, this is just the second lock.
update favorites f
set manual_sort = (o.ord - 1)::int
from unnest(@service_ids::uuid[]) with ordinality as o (service_id, ord)
where f.user_id = @user_id and f.service_id = o.service_id;

-- name: SeedManualFavoritesOrder :exec
-- One-time initialization of the manual order: number manual_sort to the order
-- the user currently sees in usage mode, so switching to manual starts from
-- what they effectively have (issue #125). The ranking deliberately mirrors
-- ListFavoritesByUsage above — the two must not drift.
update favorites f
set manual_sort = ranked.rn
from (
    select f2.service_id,
           (row_number() over (order by coalesce(cc.c, 0) desc, f2.sort, f2.created_at) - 1)::int as rn
    from favorites f2
    left join (
        select click_events.service_id, count(*) as c
        from click_events
        where click_events.user_id = @user_id
        group by click_events.service_id
    ) cc on cc.service_id = f2.service_id
    where f2.user_id = @user_id
) ranked
where f.user_id = @user_id and f.service_id = ranked.service_id;

-- name: MarkFavoritesManualSeeded :exec
update users set favorites_manual_seeded = true where id = @user_id;
