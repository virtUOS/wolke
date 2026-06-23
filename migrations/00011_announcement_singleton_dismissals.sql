-- +goose Up
-- The announcement is now a singleton: at most one may exist (product decision —
-- one notice at a time). Collapse any existing rows to the most recent, then
-- guard the invariant with a one-row unique index.
delete from announcements
where id not in (
    select id from announcements order by created_at desc limit 1
);

create unique index announcements_singleton on announcements ((true));

-- Per-user dismissals: a dismissed announcement stays gone for that user across
-- reloads/devices. Keyed by announcement id, so removing the announcement and
-- creating a new one (new id) correctly re-shows it. Cascades clean up when the
-- announcement is deleted or the user is removed.
create table announcement_dismissals (
    user_id         uuid not null references users (id) on delete cascade,
    announcement_id uuid not null references announcements (id) on delete cascade,
    dismissed_at    timestamptz not null default now(),
    primary key (user_id, announcement_id)
);

-- +goose Down
drop table announcement_dismissals;
drop index announcements_singleton;
