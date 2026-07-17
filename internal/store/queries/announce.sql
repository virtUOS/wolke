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

-- name: DeleteAnnouncement :execrows
delete from announcements where id = @id;

-- name: CountAnnouncements :one
select count(*) from announcements;

-- name: RetireActiveAnnouncements :exec
-- Close any currently-active announcement by ending its window now. Called when
-- a new announcement is created so there is at most one active notice at a time,
-- while the retired one stays in the table as history (docs/01 §4.7).
update announcements
set ends_at = now()
where (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now());

-- name: ListAnnouncementHistory :many
-- A user's past notices for the notification center: addressed to their role (or
-- all), already started, and no longer an active banner for them — either the
-- window has ended OR they dismissed it. Most recent first.
select a.*
from announcements a
where (a.starts_at is null or a.starts_at <= now())
  and (a.audience = 'all' or a.audience = @role)
  and (
    (a.ends_at is not null and a.ends_at <= now())
    or exists (
      select 1 from announcement_dismissals d
      where d.announcement_id = a.id and d.user_id = @user_id
    )
  )
order by a.created_at desc
limit @lim;

-- name: PurgeAnnouncementsBefore :execrows
-- Permanently delete expired announcements that started before the retention
-- cutoff (history retention; dismissals cascade away). Only expired notices are
-- purged, so an active banner is never removed regardless of age. starts_at may
-- be null for notices shown immediately, so fall back to created_at.
delete from announcements
where coalesce(starts_at, created_at) < @cutoff
  and ends_at is not null
  and ends_at <= now();

-- name: DismissAnnouncement :exec
-- Record a per-user dismissal. Idempotent: dismissing twice is a no-op.
insert into announcement_dismissals (user_id, announcement_id)
values (@user_id, @announcement_id)
on conflict (user_id, announcement_id) do nothing;

-- name: ListActiveAnnouncements :many
-- Active = within its time window, addressed to the user's role (or all), and
-- not already dismissed by the user, most-severe first (docs/01 §4.7).
select a.*
from announcements a
where (a.starts_at is null or a.starts_at <= now())
  and (a.ends_at is null or a.ends_at > now())
  and (a.audience = 'all' or a.audience = @role)
  and not exists (
    select 1 from announcement_dismissals d
    where d.announcement_id = a.id and d.user_id = @user_id
  )
order by case a.severity when 'critical' then 0 when 'warning' then 1 else 2 end, a.created_at desc;

-- name: ListAllActiveAnnouncements :many
-- Active = within its time window, across ALL audiences. For the public,
-- identity-less catalog MCP server, which has no user role to filter on and
-- must not hide a maintenance notice addressed to a specific role.
select *
from announcements
where (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, created_at desc;

-- name: AdminListAnnouncements :many
select * from announcements order by created_at desc limit @lim;
