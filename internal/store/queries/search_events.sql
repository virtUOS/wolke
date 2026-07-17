-- name: InsertSearchEvent :exec
-- Append one search to the log (best-effort; never blocks the search response).
insert into search_events (query_norm, result_count) values (@query_norm, @result_count);

-- name: ListZeroResultSearches :many
-- Most-searched queries that returned nothing within the last @days days — the
-- admin worklist for adding keywords (docs/01 §4.6). Aggregate-only.
select query_norm, count(*) as searches, max(created_at)::timestamptz as last_seen
from search_events
where result_count = 0 and created_at >= now() - make_interval(days => @days::int)
group by query_norm
order by searches desc, last_seen desc
limit @lim;

-- name: DeleteSearchEventsBefore :execrows
-- Retention pruning: drop events older than a cutoff (run from ops/a scheduled job).
delete from search_events where created_at < @cutoff;
