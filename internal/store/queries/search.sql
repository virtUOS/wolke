-- name: SearchServiceIDs :many
-- Fuzzy/substring search over name, localized descriptions, category labels, and
-- the admin-configured keywords (docs/01 §4.6, docs/02 §5). Returns active service
-- ids ranked by name similarity then name. Categories are attached from the
-- catalog snapshot in the handler, so the result shape matches /api/catalog.
--
-- LIKE metacharacters in the query are escaped here (the `e` CTE) so % and _ are
-- matched literally instead of acting as wildcards; @q stays raw for trigram
-- similarity. Escaping lives in SQL so every caller (HTTP + read MCP) is covered.
with e as (
    select replace(replace(replace(@q::text, '\', '\\'), '%', '\%'), '_', '\_') as q_like
)
select s.id
from services s
cross join e
left join service_categories sc on sc.service_id = s.id
left join categories c on c.id = sc.category_id
where s.is_active = true and (
    s.name ilike '%' || e.q_like || '%'
    or s.description ->> 'de' ilike '%' || e.q_like || '%'
    or s.description ->> 'en' ilike '%' || e.q_like || '%'
    or c.label ->> 'de' ilike '%' || e.q_like || '%'
    or c.label ->> 'en' ilike '%' || e.q_like || '%'
    or array_to_string(s.keywords, ' ') ilike '%' || e.q_like || '%'
    or similarity(s.name, @q) > 0.2
)
group by s.id, s.name
order by max(similarity(s.name, @q)) desc, s.name
limit 50;
