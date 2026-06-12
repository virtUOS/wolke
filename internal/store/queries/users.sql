-- name: UpsertUser :one
-- Called on every login: insert the OIDC subject or refresh the mutable fields.
-- primary_role and is_admin are re-derived from claims each login (docs/02 §6);
-- user prefs (view_mode, theme) are intentionally not touched here.
insert into users (oidc_sub, display_name, email, primary_role, is_admin)
values ($1, $2, $3, $4, $5)
on conflict (oidc_sub) do update
set display_name = excluded.display_name,
    email        = excluded.email,
    primary_role = excluded.primary_role,
    is_admin     = excluded.is_admin,
    last_seen_at = now()
returning *;

-- name: GetUserByID :one
select * from users where id = $1;

-- name: UpdateUserPrefs :one
-- Theme/view-mode persist server-side so they follow the user across devices.
update users
set view_mode = $2,
    theme     = $3
where id = $1
returning *;
