-- Development seed data. NOT loaded in production — there the catalog is living
-- data managed by admins (docs/04 §5). Idempotent: safe to re-run.
-- Apply with `make seed`.

begin;

-- Categories (slug, localized label, sort).
insert into categories (slug, label, sort) values
  ('learning',       '{"de":"Lernmanagement","en":"Learning"}',       10),
  ('teaching',       '{"de":"Lehre","en":"Teaching"}',                20),
  ('communication',  '{"de":"Kommunikation","en":"Communication"}',   30),
  ('administration', '{"de":"Verwaltung","en":"Administration"}',      40),
  ('data',           '{"de":"Netz & Daten","en":"Network & Data"}',   50),
  ('identity',       '{"de":"Identifizierung","en":"Identity"}',      60),
  ('writing',        '{"de":"Schreiben","en":"Writing"}',             70),
  ('ai-tools',       '{"de":"KI-Werkzeuge","en":"AI tools"}',         80),
  ('support',        '{"de":"Support","en":"Support"}',               90)
on conflict (slug) do update set label = excluded.label, sort = excluded.sort;

-- Services. service_url NULL => documentation-only entry (tile launches docs).
-- keywords: admin-configured search aliases (a flat, language-agnostic list) that
-- surface a service for terms not in its name or description (docs/01 §4.6).
insert into services (name, description, service_url, doc_url, icon, keywords) values
  ('Stud.IP',  '{"de":"Lernplattform für Kurse und Materialien.","en":"Course and learning-material platform."}', 'https://studip.example.edu',  'https://docs.example.edu/studip',  'graduation-cap', '{}'),
  ('MyShare',  '{"de":"Persönlicher Netzspeicher der Universität.","en":"Your university network storage."}',     'https://myshare.example.edu', 'https://docs.example.edu/myshare', 'hard-drive', '{}'),
  ('VPN',      '{"de":"Sicherer Zugriff auf das Uni-Netz von außerhalb.","en":"Secure off-campus network access."}', 'https://vpn.example.edu',   'https://docs.example.edu/vpn',     'shield', '{"remote access","fernzugriff"}'),
  ('Webmail',  '{"de":"Universitäts-E-Mail im Browser.","en":"University email in your browser."}',               'https://webmail.example.edu', 'https://docs.example.edu/mail',    'mail', '{}'),
  ('BigBlueButton', '{"de":"Web-Konferenzen und Vorlesungsaufzeichnung.","en":"Web conferencing and lecture recording."}', 'https://bbb.example.edu', 'https://docs.example.edu/bbb', 'video', '{"video conference","videokonferenz","online meeting","webinar","bbb"}'),
  ('Identitätsmanagement', '{"de":"Passwort ändern und Konto verwalten.","en":"Change your password and manage your account."}', 'https://idm.example.edu', 'https://docs.example.edu/account', 'key-round', '{}'),
  ('WLAN an der UOS', '{"de":"So verbindest du dich mit eduroam.","en":"How to connect to eduroam."}', NULL, 'https://docs.example.edu/wifi', 'wifi', '{wifi,internet}')
on conflict (name) do update set keywords = excluded.keywords;

-- Category attachments (by name/slug, so this stays readable).
insert into service_categories (service_id, category_id)
select s.id, c.id from services s, categories c where (s.name, c.slug) in (
  ('Stud.IP', 'learning'), ('Stud.IP', 'teaching'),
  ('MyShare', 'data'),
  ('VPN', 'data'),
  ('Webmail', 'communication'),
  ('BigBlueButton', 'teaching'), ('BigBlueButton', 'communication'),
  ('Identitätsmanagement', 'identity'),
  ('WLAN an der UOS', 'data')
)
on conflict do nothing;

-- Per-role default ordering (admin-curated in prod; seeded here for dev).
insert into role_defaults (role, service_id, sort)
select 'student', id, row_number() over (order by name) from services
where name in ('Stud.IP', 'WLAN an der UOS', 'Identitätsmanagement', 'MyShare')
on conflict do nothing;

insert into role_defaults (role, service_id, sort)
select 'teacher', id, row_number() over (order by name) from services
where name in ('Stud.IP', 'BigBlueButton', 'MyShare', 'Webmail')
on conflict do nothing;

insert into role_defaults (role, service_id, sort)
select 'staff', id, row_number() over (order by name) from services
where name in ('Webmail', 'MyShare', 'VPN', 'Identitätsmanagement')
on conflict do nothing;

commit;
