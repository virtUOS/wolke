-- +goose Up
-- Service names are a natural key — the seed and admin tooling rely on it — so
-- enforce uniqueness. First drop any duplicate rows a non-idempotent dev seed
-- may have created (a no-op in production, which never runs the seed), keeping
-- one row per name; cascades clean their category links, role defaults, and
-- favorites.
delete from services a using services b
where a.name = b.name and a.ctid > b.ctid;

create unique index services_name_key on services (name);

-- +goose Down
drop index services_name_key;
