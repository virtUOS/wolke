-- +goose Up
-- Personalization (docs/02 §4): favorite lists + items, and usage tracking that
-- powers "frequently used" (per-user) and, later, aggregate metrics (docs/01 §5.4).

-- Personal lists (the Figma "Täglicher Gebrauch", "Wichtig für die Uni", …).
create table favorite_lists (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users (id) on delete cascade,
    name        text not null,
    sort        integer not null default 0,
    is_default  boolean not null default false,
    created_at  timestamptz not null default now()
);
create index favorite_lists_user_idx on favorite_lists (user_id, sort);
-- At most one default list per user (the quick-star target).
create unique index favorite_lists_one_default on favorite_lists (user_id) where is_default;

create table favorite_items (
    list_id     uuid not null references favorite_lists (id) on delete cascade,
    service_id  uuid not null references services (id) on delete cascade,
    sort        integer not null default 0,
    created_at  timestamptz not null default now(),
    primary key (list_id, service_id)
);
create index favorite_items_list_sort_idx on favorite_items (list_id, sort);

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
drop table favorite_items;
drop table favorite_lists;
