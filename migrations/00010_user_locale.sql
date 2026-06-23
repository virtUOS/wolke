-- +goose Up
-- Per-user UI language preference. 'auto' (default) keeps the existing behavior:
-- the language is detected from the browser, falling back to branding.default_locale.
-- 'de'/'en' let a user pin the language regardless of their browser (concept:
-- the app is genuinely de/en, and prefs persist server-side so they follow the
-- user across devices).
alter table users
    add column locale text not null default 'auto'
        check (locale in ('auto', 'de', 'en'));

-- +goose Down
alter table users
    drop column locale;
