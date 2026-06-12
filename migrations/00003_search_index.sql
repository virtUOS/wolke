-- +goose Up
-- Trigram GIN indexes on the localized description fields so ILIKE/similarity
-- search over name + description stays index-backed as the catalog grows
-- (docs/02 §4–§5). The name index ships in 00002.
create index services_desc_de_trgm_idx on services using gin ((description ->> 'de') gin_trgm_ops);
create index services_desc_en_trgm_idx on services using gin ((description ->> 'en') gin_trgm_ops);

-- +goose Down
drop index services_desc_en_trgm_idx;
drop index services_desc_de_trgm_idx;
