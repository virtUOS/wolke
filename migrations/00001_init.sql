-- +goose Up
-- First migration: the minimum needed to exercise the pgx+sqlc pipeline and to
-- back the Postgres-stored sessions chosen for Phase 0. The full schema
-- (services, favorites, click_events, announcements, audit_log, …) lands with
-- the phases that use it (docs/02 §4). gen_random_uuid() is built into PG 13+.

-- A thin local mirror of the OIDC subject; no passwords are stored (docs/02 §4).
create table users (
    id            uuid primary key default gen_random_uuid(),
    oidc_sub      text unique not null,
    display_name  text not null,
    email         text,
    primary_role  text not null check (primary_role in ('student', 'teacher', 'staff')),
    is_admin      boolean not null default false,
    view_mode     text not null default 'auto' check (view_mode in ('list', 'table', 'auto')),
    theme         text not null default 'system' check (theme in ('light', 'dark', 'system')),
    created_at    timestamptz not null default now(),
    last_seen_at  timestamptz not null default now()
);

-- Server-side sessions (BFF pattern, docs/02 §6). id holds an opaque, random
-- session identifier; the cookie carries it signed via SESSION_SECRET. The
-- token-hashing/refresh policy is decided when the OIDC flow lands in Phase 1.
create table sessions (
    id          text primary key,
    user_id     uuid not null references users (id) on delete cascade,
    data        jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

-- Managed category set; labels are localized JSONB {de,en} (docs/02 §4).
create table categories (
    id     uuid primary key default gen_random_uuid(),
    slug   text unique not null,
    label  jsonb not null,
    sort   integer not null default 0
);

-- +goose Down
drop table categories;
drop table sessions;
drop table users;
