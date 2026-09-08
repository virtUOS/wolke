-- name: CountActiveSessions :one
select count(*) from sessions where expires_at > now();

-- name: CountServicesByState :many
select is_active, count(*) as n from services group by is_active;

-- name: CountActiveAnnouncementsBySeverity :many
select severity, count(*) as n
from announcements
where (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
group by severity;

-- name: CountFavoritesByService :many
-- Favorites per active service. The left join keeps a service nobody has
-- pinned in the result with n = 0, so its gauge series exists rather than
-- silently dropping out of the dashboard.
select s.name, count(f.user_id) as n
from services s
left join favorites f on f.service_id = s.id
where s.is_active = true
group by s.name;
