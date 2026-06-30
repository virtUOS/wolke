-- name: SearchServiceIDs :many
-- Fuzzy/substring search over name, localized descriptions, category labels, and
-- the admin-configured keywords (docs/01 §4.6, docs/02 §5). Returns active service
-- ids ranked by name similarity then name. Categories are attached from the
-- catalog snapshot in the handler, so the result shape matches /api/catalog.
select s.id
from services s
left join service_categories sc on sc.service_id = s.id
left join categories c on c.id = sc.category_id
where s.is_active = true and (
    s.name ilike '%' || @q || '%'
    or s.description ->> 'de' ilike '%' || @q || '%'
    or s.description ->> 'en' ilike '%' || @q || '%'
    or c.label ->> 'de' ilike '%' || @q || '%'
    or c.label ->> 'en' ilike '%' || @q || '%'
    or array_to_string(s.keywords, ' ') ilike '%' || @q || '%'
    or similarity(s.name, @q) > 0.2
)
group by s.id, s.name
order by max(similarity(s.name, @q)) desc, s.name
limit 50;
