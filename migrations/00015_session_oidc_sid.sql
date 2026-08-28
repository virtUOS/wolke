-- +goose Up
-- OIDC back-channel logout (docs/specs/m3-backchannel-logout.md): remember the
-- IdP session id (`sid` ID-token claim) a wolke session was created from, so an
-- IdP logout token can name exactly the sessions to end. Nullable — not every
-- IdP sends sid, and pre-existing rows have none.
alter table sessions add column oidc_sid text;
create index sessions_oidc_sid_idx on sessions (oidc_sid) where oidc_sid is not null;

-- +goose Down
drop index sessions_oidc_sid_idx;
alter table sessions drop column oidc_sid;
