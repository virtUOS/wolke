-- name: CreateAnnouncement :one
insert into announcements (title, body, severity, audience, starts_at, ends_at, dismissible, created_by)
values (@title, @body, @severity, @audience, @starts_at, @ends_at, @dismissible, @created_by)
returning *;

-- name: UpdateAnnouncement :one
update announcements
set title       = @title,
    body        = @body,
    severity    = @severity,
    audience    = @audience,
    starts_at   = @starts_at,
    ends_at     = @ends_at,
    dismissible = @dismissible
where id = @id
returning *;

-- name: GetAnnouncementByID :one
select * from announcements where id = @id;

-- name: ListActiveAnnouncements :many
-- Active = within its time window and addressed to the user's role (or all),
-- most-severe first (docs/01 §4.7).
select *
from announcements
where (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
  and (audience = 'all' or audience = @role)
order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, created_at desc;

-- name: AdminListAnnouncements :many
select * from announcements order by created_at desc limit @lim;
