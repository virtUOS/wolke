-- +goose Up
-- The catalog: services, their many-to-many categories, and the admin-curated
-- per-role default ordering (docs/02 §4). Search uses Postgres trigram matching
-- (docs/02 §5), so the extension and a GIN index on name ship here.
create extension if not exists pg_trgm;

create table services (
    id           uuid primary key default gen_random_uuid(),
    name         text not null,
    description  jsonb not null,                 -- short, {"de":..,"en":..}
    service_url  text,                           -- NULL => documentation-only entry
    doc_url      text,
    icon         text not null,                  -- a lucide icon name (validated in the service layer)
    is_active    boolean not null default true,  -- soft delete = false
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
create index services_is_active_idx on services (is_active);
create index services_name_trgm_idx on services using gin (name gin_trgm_ops);

create table service_categories (
    service_id  uuid not null references services (id) on delete cascade,
    category_id uuid not null references categories (id) on delete restrict,
    primary key (service_id, category_id)
);
create index service_categories_category_idx on service_categories (category_id);

-- Admin-curated default ordering shown to each role on first visit (docs/01 §3).
create table role_defaults (
    role        text not null check (role in ('student', 'teacher', 'staff')),
    service_id  uuid not null references services (id) on delete cascade,
    sort        integer not null default 0,
    primary key (role, service_id)
);

-- +goose Down
drop table role_defaults;
drop table service_categories;
drop table services;
-- pg_trgm is left installed; other features may rely on it.
