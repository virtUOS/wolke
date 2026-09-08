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
insert into services (name, description, service_url, doc_url, icon, tag, keywords)
values (@name, @description, @service_url, @doc_url, @icon, @tag, @keywords)
returning *;

-- name: UpdateService :one
update services
set name        = @name,
    description = @description,
    service_url = @service_url,
    doc_url     = @doc_url,
    icon        = @icon,
    tag         = @tag,
    keywords    = @keywords,
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
insert into categories (slug, label, sort, visibility)
values (@slug, @label, @sort, @visibility) returning *;

-- name: AdminListCategories :many
-- Every category with its visibility, unnarrowed — the admin screens manage
-- categories they do not themselves hold (docs/specs/service-visibility.md §5).
select * from categories order by sort, slug;

-- name: ListServiceRestrictedCategories :many
-- The visibility slugs of the restricted categories a service belongs to
-- (empty = the service is public). One row per distinct slug; the read model's
-- predicate needs every one of them held (docs/specs/service-visibility.md
-- §2.2, restricted wins).
select distinct c.visibility
from service_categories sc
join categories c on c.id = sc.category_id
where sc.service_id = @service_id and c.visibility is not null;

-- name: PurgeRoleDefaultsForCategory :many
-- Deletes every role's default-view row for every service in one category and
-- reports the affected roles. Runs when a category becomes restricted: default
-- views stay public-only (docs/specs/service-visibility.md §2.2), and leaving
-- the rows behind would wedge those roles' editors, whose every save would then
-- be rejected.
with purged as (
    delete from role_defaults rd
    using service_categories sc
    where sc.service_id = rd.service_id and sc.category_id = @category_id
    returning rd.role
)
select distinct role from purged;

-- name: DeleteRoleDefaults :exec
delete from role_defaults where role = @role;

-- name: PurgeRoleDefaultsNotIn :many
-- Deletes the default-view rows of every role outside the configured set and
-- reports which roles those were (for the audit diff). One statement, so the
-- read and the delete cannot disagree. The role set is config, not schema —
-- see internal/service/roles.go.
with purged as (
    delete from role_defaults where role <> all(@roles::text[]) returning role
)
select distinct role from purged;

-- name: AddRoleDefault :exec
insert into role_defaults (role, service_id, sort) values (@role, @service_id, @sort);

-- name: InsertAudit :exec
insert into audit_log (actor_id, actor_kind, action, target_id, diff)
values (@actor_id, @actor_kind, @action, @target_id, @diff);

-- name: ListAudit :many
-- LEFT JOIN so rows whose actor_id is null (MCP/system, or no user) still list;
-- actor_name resolves the acting user for the admin audit view.
select a.*, u.display_name as actor_name
from audit_log a
left join users u on u.id = a.actor_id
order by a.created_at desc limit @lim;

-- name: PurgeRoleDefaultsForService :many
-- Deletes every role's default-view row for one service and reports which
-- roles lost one (for the audit diff). Used when a service becomes restricted:
-- default views stay public-only (docs/specs/service-visibility.md §7.1), so
-- the write that restricts a service is the write that removes it as a default.
with purged as (
    delete from role_defaults where service_id = @service_id returning role
)
select distinct role from purged order by role;
