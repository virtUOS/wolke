-- +goose Up
-- Zero-result search logging (docs/01 §4.6, docs/02 §5): which queries users run
-- and how many results came back, so admins can see what people search for and
-- find nothing — the worklist for adding service keywords, and the proof a fix
-- worked (the query stops showing up empty).
--
-- Privacy: aggregate-only. We store the normalized query text and a result count,
-- never a user id. Retention is bounded by pruning old rows (DeleteSearchEventsBefore).
create table search_events (
    id            bigserial primary key,
    query_norm    text not null,          -- lowercased, trimmed query as typed
    result_count  integer not null,
    created_at    timestamptz not null default now()
);
-- The insights view groups recent zero-result queries; a partial index keeps that
-- read cheap without indexing the (larger) set of successful searches.
create index search_events_zero_idx on search_events (created_at desc) where result_count = 0;

-- +goose Down
drop table search_events;
