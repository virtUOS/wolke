-- +goose Up
-- Distinguish a launch click (target='service') from a documentation-link click
-- (target='documentation'), so per-service click metrics break down by which link
-- the user followed (docs/01 §5.4). Existing rows are launches (the default).
alter table click_events
    add column target text not null default 'service'
    check (target in ('service', 'documentation'));

-- usage_daily rolls up by target too, so the aggregate stays additive.
alter table usage_daily add column target text not null default 'service';
alter table usage_daily drop constraint usage_daily_pkey;
alter table usage_daily add primary key (day, service_id, user_role, target);

-- +goose Down
-- usage_daily is a derived rollup (recomputed by RollupClicks from click_events),
-- so rebuild it without the target dimension rather than folding per-target rows
-- — which would collide on the restored primary key. The next rollup repopulates.
drop table usage_daily;
create table usage_daily (
    day         date not null,
    service_id  uuid not null,
    user_role   text not null,
    clicks      bigint not null default 0,
    primary key (day, service_id, user_role)
);
alter table click_events drop column target;
