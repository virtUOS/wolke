-- +goose Up
-- Service visibility v2 (docs/specs/service-visibility.md): the two needs v1
-- conflated split apart. "Experimental" is the `beta` tag the schema already
-- had, revealed by a user pref; "restricted" moves from the service to the
-- category, because assigning a service to IT-Infrastruktur IS restricting it.
--
-- Dropping v1's two columns is safe: no deployment ever configured a
-- visibility slug (the block ships empty and both columns default to
-- empty/NULL), so neither carries data anywhere.

-- NULL = public, today's behaviour. A slug restricts the category and
-- everything in it to the users holding that slug. The slugs are deployment
-- config (the `visibility:` block), not schema — like roles — so there is no
-- check constraint; the service layer validates against the configured set.
-- A slug that is no longer configured fails closed: nobody holds it, so nobody
-- sees the category.
alter table categories add column visibility text;

-- The user's own choice to see beta services, a sibling of
-- favorites_separate_tab and written through the same prefs path. Default
-- false: beta services are hidden until asked for.
alter table users add column show_beta boolean not null default false;

-- v1's per-service slug and self-granted opt-in list. visibility_claims stays:
-- claims -> held slugs is unchanged, it now gates categories instead.
alter table services drop column visibility;
alter table users drop column visibility_optin;

-- +goose Down
alter table users add column visibility_optin text[] not null default '{}';
alter table services add column visibility text;
alter table users drop column show_beta;
alter table categories drop column visibility;
