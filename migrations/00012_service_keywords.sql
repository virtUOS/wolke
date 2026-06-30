-- +goose Up
-- Admin-configurable search keywords per service: terms that should surface a
-- service even when they appear in neither its name nor its description (e.g.
-- "video conference" -> BigBlueButton). A flat, language-agnostic list — admins
-- mix German and English terms — that search matches alongside name, description,
-- and category labels (docs/01 §4.6, docs/02 §5).
--
-- No trigram index here: a GIN index over the joined keywords would need an
-- IMMUTABLE wrapper (array_to_string / array-to-text casts are not immutable),
-- and the catalog is small enough that the keyword predicate is cheap. Revisit
-- with an immutable-wrapper index only if the HA/scale trigger is hit (docs/02 §9).
alter table services add column keywords text[] not null default '{}';

-- +goose Down
alter table services drop column keywords;
