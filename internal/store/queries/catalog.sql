-- name: ListCategories :many
select id, slug, label, sort from categories order by sort, slug;

-- name: ListActiveServices :many
select id, name, description, service_url, doc_url, icon, tag
from services
where is_active = true
order by name;

-- name: ListActiveServiceCategories :many
-- (service_id, category slug) pairs for active services, to assemble the
-- many-to-many in Go when building the catalog snapshot.
select sc.service_id, c.slug
from service_categories sc
join categories c on c.id = sc.category_id
join services s on s.id = sc.service_id
where s.is_active = true;

-- name: GetRoleDefaults :many
-- Active services in the admin-curated order for a role (docs/01 §3).
select rd.service_id
from role_defaults rd
join services s on s.id = rd.service_id
where rd.role = $1 and s.is_active = true
order by rd.sort, s.name;
