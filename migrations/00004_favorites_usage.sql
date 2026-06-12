-- +goose Up
-- Personalization (docs/02 §4): a flat per-user favorites set (no named lists —
-- concept §4.4), and usage tracking that powers "frequently used" (per-user) and,
-- later, aggregate metrics (docs/01 §5.4).

-- Favorites: a flat per-user set of services.
create table favorites (
    user_id     uuid not null references users (id) on delete cascade,
    service_id  uuid not null references services (id) on delete cascade,
    sort        integer not null default 0,
    created_at  timestamptz not null default now(),
    primary key (user_id, service_id)
);
create index favorites_user_sort_idx on favorites (user_id, sort);

-- Raw click events: feed "frequently used" (per user) and aggregate metrics.
-- user_id/service_id null on delete so history degrades gracefully (docs/01 §5.1).
create table click_events (
    id          bigserial primary key,
    user_id     uuid references users (id) on delete set null,
    service_id  uuid references services (id) on delete set null,
    user_role   text not null,
    clicked_at  timestamptz not null default now()
);
create index click_events_user_time_idx on click_events (user_id, clicked_at);
create index click_events_service_time_idx on click_events (service_id, clicked_at);

-- Daily rollup for cheap aggregate metric reads (populated by a job in Phase 4).
create table usage_daily (
    day         date not null,
    service_id  uuid not null,
    user_role   text not null,
    clicks      bigint not null default 0,
    primary key (day, service_id, user_role)
);

-- +goose Down
drop table usage_daily;
drop table click_events;
drop table favorites;
