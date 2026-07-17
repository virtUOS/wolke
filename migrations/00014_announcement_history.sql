-- +goose Up
-- Announcements gain a history (docs/01 §4.7): past notices are retained, not
-- destroyed on replace, so users can review them in the notification center.
-- The old "one row ever" singleton index is dropped; the "one ACTIVE notice at a
-- time" product rule now lives in the service layer (creating a new announcement
-- retires the current active one into history). A configurable retention sweep
-- (ANNOUNCEMENT_RETENTION_DAYS) purges old rows permanently.
drop index announcements_singleton;

-- +goose Down
-- Restore the singleton: collapse history to the most recent row, then re-create
-- the one-row guard (mirrors 00011). Forward-only in practice; this exists so the
-- migration is reversible in dev.
delete from announcements
where id not in (
    select id from announcements order by created_at desc limit 1
);
create unique index announcements_singleton on announcements ((true));
