-- name: UpsertUser :one
-- Called on every login: insert the OIDC subject or refresh the mutable fields.
-- primary_role, is_admin and visibility_claims are re-derived from claims each
-- login (docs/02 §6, docs/specs/service-visibility.md §2.2), so losing the group
-- at the IdP loses the access at next login. The user's own settings are
-- intentionally not touched here — view_mode, theme, and show_beta: what the
-- IdP says is recomputed, what the user chose is never overwritten by a login.
-- coalesce keeps a nil slice meaning "no claim-granted slugs" rather than
-- violating the column's not-null constraint.
insert into users (oidc_sub, display_name, email, primary_role, is_admin, visibility_claims)
values (@oidc_sub, @display_name, @email, @primary_role, @is_admin,
        coalesce(sqlc.narg(visibility_claims)::text[], '{}'))
on conflict (oidc_sub) do update
set display_name      = excluded.display_name,
    email             = excluded.email,
    primary_role      = excluded.primary_role,
    is_admin          = excluded.is_admin,
    visibility_claims = excluded.visibility_claims,
    last_seen_at      = now()
returning *;

-- name: GetUserByID :one
select * from users where id = $1;

-- name: GetUserBySub :one
select * from users where oidc_sub = @oidc_sub;

-- name: UpdateUserPrefs :one
-- Display prefs persist server-side so they follow the user across devices.
update users
set view_mode              = @view_mode,
    theme                  = @theme,
    locale                 = @locale,
    favorites_order        = @favorites_order,
    favorites_separate_tab = @favorites_separate_tab,
    show_beta              = @show_beta
where id = @id
returning *;

