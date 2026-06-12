-- name: CreateSession :exec
-- id is sha256(token); the raw token lives only in the cookie, so a DB read
-- never yields a usable session credential.
insert into sessions (id, user_id, expires_at) values ($1, $2, $3);

-- name: GetSession :one
select id, user_id, data, created_at, expires_at
from sessions
where id = $1 and expires_at > now();

-- name: DeleteSession :exec
delete from sessions where id = $1;

-- name: DeleteExpiredSessions :exec
delete from sessions where expires_at <= now();
