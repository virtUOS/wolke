-- name: RecordClick :exec
-- A lightweight launch-click event (docs/01 §5.4). user_role is denormalized so
-- aggregate metrics (Phase 4) need no join. NULLs on user/service delete keep
-- history intact when a user or service is removed.
insert into click_events (user_id, service_id, user_role)
values (@user_id, @service_id, @user_role);

-- name: FrequentServiceIDs :many
-- The user's most-clicked active services within a rolling window, most-used
-- first (powers "frequently used" — docs/01 §4.5).
select ce.service_id
from click_events ce
join services s on s.id = ce.service_id
where ce.user_id = @user_id and ce.clicked_at >= @since and s.is_active = true
group by ce.service_id
order by count(*) desc, max(ce.clicked_at) desc
limit @lim;
