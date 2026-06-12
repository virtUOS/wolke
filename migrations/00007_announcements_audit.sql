-- +goose Up
-- Announcements (docs/01 §4.7) and the audit log that records every catalog /
-- announcement write from the form or the MCP server (docs/01 §5.5, docs/02 §4).

create table announcements (
    id           uuid primary key default gen_random_uuid(),
    title        jsonb not null,                 -- {de,en}
    body         jsonb not null,                 -- {de,en}
    severity     text not null check (severity in ('info', 'warning', 'critical')),
    audience     text not null default 'all' check (audience in ('all', 'student', 'teacher', 'staff')),
    starts_at    timestamptz,
    ends_at      timestamptz,
    dismissible  boolean not null default true,
    created_by   uuid references users (id),
    created_at   timestamptz not null default now()
);
-- Active-window lookups for the user-facing banner.
create index announcements_window_idx on announcements (starts_at, ends_at);

-- Every write via form OR MCP lands here (docs/02 §4, §8).
create table audit_log (
    id          bigserial primary key,
    actor_id    uuid references users (id),
    actor_kind  text not null check (actor_kind in ('form', 'mcp')),
    action      text not null,                   -- 'service.create', 'announcement.create', …
    target_id   uuid,
    diff        jsonb,                           -- before/after
    created_at  timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at desc);

-- +goose Down
drop table audit_log;
drop table announcements;
