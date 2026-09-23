-- name: CountActiveSessionsByRole :many
-- Currently valid sessions per configured role. Same two-branch shape as
-- CountFavoritesByServiceAndRole below, and for the same two reasons:
--
--  1. Unnesting the configured role list emits a zero for every role, so a role
--     nobody is logged in under reads 0 rather than dropping out of the
--     dashboard — a gap there is ambiguous between "nobody logged in" and "the
--     exporter stopped" (#128's property, now on sessions).
--  2. The real counts are grouped by the role as stored on the user. Roles the
--     config no longer defines come back verbatim; the caller folds them onto
--     the configured default (internal/metrics) via config.RoleSet.Effective,
--     which keeps the "effective role" rule in one place rather than
--     duplicating it here.
--
-- A role therefore appears more than once and the caller sums; the zero rows
-- are the additive identity that makes that safe.
select r.role::text as role, 0::bigint as n
from unnest(@roles::text[]) as r(role)
union all
select u.primary_role as role, count(*) as n
from sessions s
join users u on u.id = s.user_id
where s.expires_at > now()
group by u.primary_role;

-- name: CountServicesByState :many
select is_active, count(*) as n from services group by is_active;

-- name: CountActiveAnnouncementsBySeverity :many
select severity, count(*) as n
from announcements
where (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
group by severity;

-- name: CountFavoritesByServiceAndRole :many
-- Favorites per active service and configured role. Two branches:
--
--  1. The cross join of active services with the configured role list emits a
--     zero for every (service × role) pair, so a service nobody pinned — or a
--     role that pinned nothing — keeps its series instead of dropping out of
--     the dashboard (#128's deliberate property, now in two dimensions).
--  2. The actual counts, grouped by the role as stored on the user. Roles the
--     config no longer defines come back verbatim; the caller folds them onto
--     the configured default (internal/metrics), which keeps the "effective
--     role" rule in one place — config.RoleSet.Effective — rather than
--     duplicating it here as a second parameter and a case expression.
--
-- A (service, role) pair therefore appears more than once and the caller sums;
-- the zero rows are the additive identity that makes that safe.
select s.name, r.role::text as role, 0::bigint as n
from services s
cross join unnest(@roles::text[]) as r(role)
where s.is_active = true
union all
select s.name, u.primary_role as role, count(*) as n
from favorites f
join users u on u.id = f.user_id
join services s on s.id = f.service_id
where s.is_active = true
group by s.name, u.primary_role;
