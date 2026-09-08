-- +goose Up
-- Issue #34 / #121: service visibility (docs/specs/service-visibility.md).
--
-- A service is public (NULL) or restricted to one visibility slug. The slugs
-- themselves are deployment config (the `visibility:` block), not schema — the
-- same way roles are — so there is no check constraint here; the service layer
-- validates against the configured set. A slug that is no longer configured
-- fails closed: nobody holds it, so nobody sees the service.
alter table services add column visibility text;

-- A user holds a slug either because an IdP claim granted it (recomputed at
-- login, like is_admin — Stage 2 of the spec) or because they opted in
-- themselves (Stage 1, the experimental flavour). Kept apart so a slug whose
-- grant type changes in config cannot leave self-granted access behind: each
-- source only counts for slugs of its own grant type.
alter table users
    add column visibility_claims text[] not null default '{}',
    add column visibility_optin  text[] not null default '{}';

-- +goose Down
alter table users drop column visibility_optin;
alter table users drop column visibility_claims;
alter table services drop column visibility;
