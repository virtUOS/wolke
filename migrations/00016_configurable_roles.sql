-- +goose Up
-- Configurable role set (docs/specs/configurable-roles.md): the roles are
-- derived from the deployment's OIDC claim mapping (values ∪ precedence ∪
-- default), so 'student|teacher|staff' was never a property of the schema — it
-- was one deployment's configuration frozen into three check constraints. A
-- config-time set cannot be a schema-time constraint: a deployment that
-- configures two roles, or six, would fail its own writes.
--
-- Validation moves to /internal/service (CLAUDE.md rule 3), where both the HTTP
-- handlers and the MCP tools already share it. Stale rows are handled at read
-- time rather than by the database: an unknown users.primary_role reads as the
-- configured default (and heals at next login), unknown role_defaults rows are
-- invisible (and are purged on that role's next write), and an announcement
-- addressed to an unknown role reaches nobody but stays visible, flagged, in
-- the admin list.
--
-- click_events.user_role and usage_daily.user_role are already free text.
alter table users drop constraint if exists users_primary_role_check;
alter table role_defaults drop constraint if exists role_defaults_role_check;
alter table announcements drop constraint if exists announcements_audience_check;

-- +goose Down
-- Restoring the constraints can fail on data a differently-configured
-- deployment wrote — which is exactly the point of dropping them. The three
-- values below are the original example set (migrations 00001/00002/00007).
alter table users add constraint users_primary_role_check
  check (primary_role in ('student', 'teacher', 'staff'));
alter table role_defaults add constraint role_defaults_role_check
  check (role in ('student', 'teacher', 'staff'));
alter table announcements add constraint announcements_audience_check
  check (audience in ('all', 'student', 'teacher', 'staff'));
