-- name: AdminListServices :many
-- Full catalog including soft-deleted (inactive) services.
select * from services order by name;

-- name: GetServiceByID :one
select * from services where id = @id;

-- name: ListServiceCategorySlugs :many
select c.slug
from service_categories sc
join categories c on c.id = sc.category_id
where sc.service_id = @service_id
order by c.slug;

-- name: CreateService :one
insert into services (name, description, service_url, doc_url, icon)
values (@name, @description, @service_url, @doc_url, @icon)
returning *;

-- name: UpdateService :one
update services
set name        = @name,
    description = @description,
    service_url = @service_url,
    doc_url     = @doc_url,
    icon        = @icon,
    updated_at  = now()
where id = @id
returning *;

-- name: SoftDeleteService :execrows
update services set is_active = false, updated_at = now() where id = @id and is_active = true;

-- name: DeleteServiceCategories :exec
delete from service_categories where service_id = @service_id;

-- name: AddServiceCategory :exec
insert into service_categories (service_id, category_id)
values (@service_id, @category_id)
on conflict do nothing;

-- name: GetCategoryBySlug :one
select * from categories where slug = @slug;

-- name: CreateCategory :one
insert into categories (slug, label, sort) values (@slug, @label, @sort) returning *;

-- name: DeleteRoleDefaults :exec
delete from role_defaults where role = @role;

-- name: AddRoleDefault :exec
insert into role_defaults (role, service_id, sort) values (@role, @service_id, @sort);

-- name: InsertAudit :exec
insert into audit_log (actor_id, actor_kind, action, target_id, diff)
values (@actor_id, @actor_kind, @action, @target_id, @diff);

-- name: ListAudit :many
select * from audit_log order by created_at desc limit @lim;
