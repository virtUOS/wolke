-- +goose Up
-- Service status tags: beta (new/experimental) or wartung (maintenance).
-- At most one tag per service; null = no tag shown in the tile.
alter table services add column tag text check (tag in ('beta', 'wartung'));

-- +goose Down
alter table services drop column tag;
