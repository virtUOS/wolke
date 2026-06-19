-- name: RecordClick :exec
-- A lightweight click event (docs/01 §5.4). user_role is denormalized so
-- aggregate metrics (Phase 4) need no join. target distinguishes a launch
-- ('service') from a documentation-link click ('documentation'). NULLs on
-- user/service delete keep history intact when a user or service is removed.
insert into click_events (user_id, service_id, user_role, target)
values (@user_id, @service_id, @user_role, @target);

-- name: RollupClicks :exec
-- Recompute usage_daily from the raw events still present (the retention
-- window). Idempotent: SET (not add). Days whose raw events have been purged are
-- no longer recomputed, so their aggregate rows stay frozen at their last value.
insert into usage_daily (day, service_id, user_role, target, clicks)
select date(clicked_at), service_id, user_role, target, count(*)
from click_events
where service_id is not null
group by date(clicked_at), service_id, user_role, target
on conflict (day, service_id, user_role, target) do update set clicks = excluded.clicks;

-- name: PurgeOldClicks :execrows
delete from click_events where clicked_at < @cutoff;

-- name: FrequentServiceIDs :many
-- The user's most-clicked active services within a rolling window, most-used
-- first (powers "frequently used" — docs/01 §4.5). Launches only (target =
-- 'service'); a documentation-link click shouldn't promote a service here.
select ce.service_id
from click_events ce
join services s on s.id = ce.service_id
where ce.user_id = @user_id and ce.clicked_at >= @since and s.is_active = true
  and ce.target = 'service'
group by ce.service_id
order by count(*) desc, max(ce.clicked_at) desc
limit @lim;
