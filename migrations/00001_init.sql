-- +goose Up
-- v1 baseline. This replaces the pre-v1 migration history (00001-00016), which
-- flattened here because no production database exists yet — only reseedable
-- test systems, so there was nothing left to replay. Full history (favorites
-- lists added then dropped, the announcement model reworked twice, keywords
-- bolted on, the role set made configurable) lives in git; it no longer
-- executes. From this baseline on, changes are new, numbered, forward-only
-- migrations (CLAUDE.md).
create extension if not exists pg_trgm;

-- A thin local mirror of the OIDC subject; no passwords are stored (docs/02 §4).
-- Role validation (primary_role) lives in /internal/service, not a check
-- constraint: the role set is derived from the deployment's OIDC claim mapping
-- (docs/02 §6, docs/specs/configurable-roles.md), so it can't be frozen into
-- the schema — a two-role or six-role deployment would fail its own writes.
-- A row outside the configured set reads as the default role and heals at the
-- user's next login.
create table users (
    id                     uuid primary key default gen_random_uuid(),
    oidc_sub               text unique not null,
    display_name           text not null,
    email                  text,
    primary_role           text not null,
    is_admin               boolean not null default false,
    view_mode              text not null default 'auto' check (view_mode in ('list', 'table', 'auto')),
    theme                  text not null default 'system' check (theme in ('light', 'dark', 'system')),
    created_at             timestamptz not null default now(),
    last_seen_at           timestamptz not null default now(),
    -- Favorites personalization (concept §4.4): 'usage' sorts by the user's click
    -- counts, 'alpha' by service name; favorites_separate_tab moves favorites into
    -- their own tab instead of a section above the catalog; favorites_seeded
    -- drives the one-time pre-fill of favorites from the user's role_defaults.
    favorites_order        text not null default 'usage' check (favorites_order in ('usage', 'alpha')),
    favorites_separate_tab boolean not null default false,
    favorites_seeded       boolean not null default false,
    -- UI language: 'auto' detects from the browser (falling back to
    -- branding.default_locale); 'de'/'en' pin it, following the user across
    -- devices since prefs persist server-side.
    locale                 text not null default 'auto' check (locale in ('auto', 'de', 'en'))
);

-- Server-side sessions (BFF pattern, docs/02 §6). id holds an opaque, random
-- session identifier; the cookie carries it signed via SESSION_SECRET. No
-- tokens reach the browser. oidc_sid remembers the IdP session id (the `sid`
-- ID-token claim) a session was created from, so a back-channel logout token
-- can name exactly the sessions to end (docs/specs/m3-backchannel-logout.md);
-- nullable because not every IdP sends sid.
create table sessions (
    id          text primary key,
    user_id     uuid not null references users (id) on delete cascade,
    data        jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    oidc_sid    text
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);
create index sessions_oidc_sid_idx on sessions (oidc_sid) where oidc_sid is not null;

-- Managed category set; labels are localized JSONB {de,en} (docs/02 §4).
create table categories (
    id     uuid primary key default gen_random_uuid(),
    slug   text unique not null,
    label  jsonb not null,
    sort   integer not null default 0
);

-- The catalog. name is a natural key (the seed and admin tooling rely on it),
-- enforced unique. is_active is a soft delete: a deactivated service stays in
-- history (audit log, click events, role_defaults) instead of breaking those
-- references. tag flags at most one status badge; keywords are admin-curated
-- search aliases, search-only (never exposed via /api/catalog, docs/02 §5).
create table services (
    id           uuid primary key default gen_random_uuid(),
    name         text not null,
    description  jsonb not null,                 -- short, {"de":..,"en":..}
    service_url  text,                           -- NULL => documentation-only entry
    doc_url      text,
    icon         text not null,                  -- a lucide icon name (validated in the service layer)
    is_active    boolean not null default true,  -- soft delete = false
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    tag          text check (tag in ('beta', 'wartung')),
    keywords     text[] not null default '{}'
);
create index services_is_active_idx on services (is_active);
create index services_name_trgm_idx on services using gin (name gin_trgm_ops);
-- Trigram GIN on the localized description fields so ILIKE/similarity search
-- stays index-backed as the catalog grows (docs/02 §4-§5). No index on
-- keywords: a GIN index over the joined array would need an IMMUTABLE wrapper
-- (array_to_string/array-to-text casts aren't immutable), and the catalog is
-- small enough that the predicate is cheap — revisit only if the HA/scale
-- trigger (docs/02 §9) is hit.
create index services_desc_de_trgm_idx on services using gin ((description ->> 'de') gin_trgm_ops);
create index services_desc_en_trgm_idx on services using gin ((description ->> 'en') gin_trgm_ops);
create unique index services_name_key on services (name);

create table service_categories (
    service_id  uuid not null references services (id) on delete cascade,
    category_id uuid not null references categories (id) on delete restrict,
    primary key (service_id, category_id)
);
create index service_categories_category_idx on service_categories (category_id);

-- Admin-curated default ordering shown to each role on first visit (docs/01
-- §3). role is a configured role slug, not a check constraint — see users
-- above. A row for a role a later configuration dropped is invisible to reads
-- and purged the next time an admin saves any role's list.
create table role_defaults (
    role        text not null,
    service_id  uuid not null references services (id) on delete cascade,
    sort        integer not null default 0,
    primary key (role, service_id)
);

-- Favorites: a flat per-user set of services (no named lists — concept §4.4).
create table favorites (
    user_id     uuid not null references users (id) on delete cascade,
    service_id  uuid not null references services (id) on delete cascade,
    sort        integer not null default 0,
    created_at  timestamptz not null default now(),
    primary key (user_id, service_id)
);
create index favorites_user_sort_idx on favorites (user_id, sort);

-- Raw click events: feed "frequently used" (per user) and aggregate metrics
-- (docs/01 §5.1, §5.4). user_id/service_id null on delete so history degrades
-- gracefully. target distinguishes a launch click from a documentation-link
-- click; user_role is always free text (a historical record keeps the role it
-- was recorded under, even after a later role-set reconfiguration).
create table click_events (
    id          bigserial primary key,
    user_id     uuid references users (id) on delete set null,
    service_id  uuid references services (id) on delete set null,
    user_role   text not null,
    clicked_at  timestamptz not null default now(),
    target      text not null default 'service' check (target in ('service', 'documentation'))
);
create index click_events_user_time_idx on click_events (user_id, clicked_at);
create index click_events_service_time_idx on click_events (service_id, clicked_at);

-- Daily rollup for cheap aggregate metric reads, recomputed by RollupClicks
-- from click_events — a derived table, safe to truncate and repopulate.
create table usage_daily (
    day         date not null,
    service_id  uuid not null,
    user_role   text not null,
    clicks      bigint not null default 0,
    target      text not null default 'service',
    primary key (day, service_id, user_role, target)
);

-- Announcements (docs/01 §4.7) accumulate as history: rows are retained, not
-- destroyed on replace, so users can review past notices in the notification
-- center. "One ACTIVE notice at a time" is a service-layer rule, not a schema
-- one — creating a new announcement retires the current active one into
-- history. A configurable retention sweep (ANNOUNCEMENT_RETENTION_DAYS) purges
-- old rows permanently. audience is a configured role slug or 'all', not a
-- check constraint — see users above; an announcement addressed to an unknown
-- role reaches nobody but stays visible, flagged, in the admin list.
create table announcements (
    id           uuid primary key default gen_random_uuid(),
    title        jsonb not null,                 -- {de,en}
    body         jsonb not null,                 -- {de,en}
    severity     text not null check (severity in ('info', 'warning', 'critical')),
    audience     text not null default 'all',
    starts_at    timestamptz,
    ends_at      timestamptz,
    dismissible  boolean not null default true,
    created_by   uuid references users (id),
    created_at   timestamptz not null default now()
);
-- Active-window lookups for the user-facing banner.
create index announcements_window_idx on announcements (starts_at, ends_at);

-- Per-user dismissals: a dismissed announcement stays gone for that user
-- across reloads/devices. Keyed by announcement id, so removing the
-- announcement and creating a new one (new id) correctly re-shows it.
create table announcement_dismissals (
    user_id         uuid not null references users (id) on delete cascade,
    announcement_id uuid not null references announcements (id) on delete cascade,
    dismissed_at    timestamptz not null default now(),
    primary key (user_id, announcement_id)
);

-- Every write via form OR MCP lands here (docs/01 §5.5, docs/02 §4, §8).
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

-- Zero-result search logging (docs/01 §4.6, docs/02 §5): which queries users
-- run and how many results came back, so admins can see what people search
-- for and find nothing. Aggregate-only — no user id is stored. Retention is
-- bounded by pruning old rows (DeleteSearchEventsBefore).
create table search_events (
    id            bigserial primary key,
    query_norm    text not null,          -- lowercased, trimmed query as typed
    result_count  integer not null,
    created_at    timestamptz not null default now()
);
-- The insights view groups recent zero-result queries; a partial index keeps
-- that read cheap without indexing the (larger) set of successful searches.
create index search_events_zero_idx on search_events (created_at desc) where result_count = 0;

-- +goose Down
drop table search_events;
drop table audit_log;
drop table announcement_dismissals;
drop table announcements;
drop table usage_daily;
drop table click_events;
drop table favorites;
drop table role_defaults;
drop table service_categories;
drop table services;
drop table categories;
drop table sessions;
drop table users;
-- pg_trgm is left installed; other features may rely on it.
