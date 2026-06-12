-- +goose Up
-- Per-user favorites preferences (concept §4.4):
--   favorites_order        — 'usage' (default) sorts by the user's click counts,
--                            'alpha' sorts by service name.
--   favorites_separate_tab — false (default) shows favorites as a section above
--                            the catalog; true gives them their own tab.
--   favorites_seeded       — drives the one-time pre-fill of favorites from the
--                            user's role_defaults (so a new user lands on a useful
--                            set, then edits freely).
alter table users
    add column favorites_order text not null default 'usage'
        check (favorites_order in ('usage', 'alpha')),
    add column favorites_separate_tab boolean not null default false,
    add column favorites_seeded boolean not null default false;

-- +goose Down
alter table users
    drop column favorites_seeded,
    drop column favorites_separate_tab,
    drop column favorites_order;
