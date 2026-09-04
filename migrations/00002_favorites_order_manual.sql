-- +goose Up
-- Issue #125: a third favorites order, 'manual' — the user arranges their own
-- favorites and the arrangement is stored per favorite.
--
-- The issue proposed reusing favorites.sort ("in the schema since v1, currently
-- unused"). It isn't unused: it is the tiebreaker in ListFavoritesByUsage
-- (clicks desc, sort, created_at) and the column the role-default pre-fill
-- copies rd.sort into. Writing the manual arrangement there would make the
-- usage order a function of the manual one — every favorite with an equal click
-- count would follow the user's arrangement — which is exactly what the issue
-- forbids ("usage/alpha computed as today and never disturbed by a stored
-- manual order"). So the manual order gets its own column and sort keeps its
-- one job.
alter table users drop constraint users_favorites_order_check;
alter table users
    add constraint users_favorites_order_check
    check (favorites_order in ('usage', 'alpha', 'manual'));

-- The user's own arrangement, dense and 0-based, rewritten as a whole list by
-- PUT /api/favorites/order. Its index mirrors favorites_user_sort_idx: the
-- manual list is read on every favorites request in that mode.
alter table favorites add column manual_sort integer not null default 0;
create index favorites_user_manual_sort_idx on favorites (user_id, manual_sort);

-- favorites_manual_seeded: false until manual_sort has been initialized from
-- the user's usage order. Separate from favorites_seeded (the role-default
-- pre-fill) because they answer different questions and fire at different
-- moments — the first list ever, vs. the first list in manual mode. Once true,
-- switching to alpha and back must never renumber the user's own arrangement.
alter table users
    add column favorites_manual_seeded boolean not null default false;

-- +goose Down
-- 'manual' has to leave the data before it leaves the constraint, and a
-- rolled-back manual order degrades to the default rather than to nothing.
update users set favorites_order = 'usage' where favorites_order = 'manual';
alter table users drop column favorites_manual_seeded;
drop index favorites_user_manual_sort_idx;
alter table favorites drop column manual_sort;
alter table users drop constraint users_favorites_order_check;
alter table users
    add constraint users_favorites_order_check
    check (favorites_order in ('usage', 'alpha'));
