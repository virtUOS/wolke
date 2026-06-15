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
