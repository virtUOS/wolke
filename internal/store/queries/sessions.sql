-- name: CreateSession :exec
-- id is sha256(token); the raw token lives only in the cookie, so a DB read
-- never yields a usable session credential. oidc_sid is the IdP session id
-- (NULL when the IdP sends no sid claim) — back-channel logout revokes by it.
insert into sessions (id, user_id, expires_at, oidc_sid) values ($1, $2, $3, $4);

-- name: GetSession :one
select id, user_id, data, created_at, expires_at, oidc_sid
from sessions
where id = $1 and expires_at > now();

-- name: DeleteSession :exec
delete from sessions where id = $1;

-- name: DeleteSessionsBySID :execrows
-- Back-channel logout with a sid: end exactly the sessions of that IdP session.
delete from sessions where oidc_sid = $1;

-- name: DeleteSessionsByOIDCSub :execrows
-- Back-channel logout with only a sub: the IdP couldn't say which session, so
-- end every session of that user (OIDC Back-Channel Logout 1.0 §2.4 semantics).
delete from sessions using users
where sessions.user_id = users.id and users.oidc_sub = $1;

-- name: DeleteExpiredSessions :exec
delete from sessions where expires_at <= now();
