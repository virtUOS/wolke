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

-- A restricted category (docs/specs/service-visibility.md §2.2): it, and every
-- service in it, is visible only to holders of the `it-infra` group. The e2e
-- config maps that group to a claim value the mock IdP does not emit, so the
-- suite exercises the non-holder side — the category and its service are absent
-- from every read surface, and the category pill never renders.
-- Two of them, one per side of the contract: the e2e config maps `it-infra` to
-- a claim value the mock IdP does not emit (nobody holds it) and `dash-team` to
-- one it does (the test user holds it), so both the "invisible to a non-holder"
-- and the "marked as restricted for its holder" states are reachable.
insert into categories (slug, label, sort, visibility) values
  ('it-infra',  '{"de":"IT-Infrastruktur","en":"IT infrastructure"}', 100, 'it-infra'),
  ('dash-team', '{"de":"Team-Werkzeuge","en":"Team tools"}',          110, 'dash-team')
on conflict (slug) do update set label = excluded.label, sort = excluded.sort, visibility = excluded.visibility;

-- Services. service_url NULL => documentation-only entry (tile launches docs).
-- keywords: admin-configured search aliases (a flat, language-agnostic list) that
-- surface a service for terms not in its name or description (docs/01 §4.6).
-- tag: 'beta' both badges a service and hides it until the user turns on
-- "Beta-Dienste anzeigen" (docs/specs/service-visibility.md §2.1) —
-- 'Zettelkasten Labor' is the fixture the beta e2e flow toggles. 'wartung' is
-- cosmetic. A service is restricted by its CATEGORY, never by a field of its
-- own: 'Serververwaltung' sits in the restricted `it-infra` category above.
insert into services (name, description, service_url, doc_url, icon, keywords, tag) values
  ('Stud.IP',  '{"de":"Lernplattform für Kurse und Materialien.","en":"Course and learning-material platform."}', 'https://studip.example.edu',  'https://docs.example.edu/studip',  'graduation-cap', '{}', NULL),
  ('MyShare',  '{"de":"Persönlicher Netzspeicher der Universität.","en":"Your university network storage."}',     'https://myshare.example.edu', 'https://docs.example.edu/myshare', 'hard-drive', '{}', NULL),
  ('VPN',      '{"de":"Sicherer Zugriff auf das Uni-Netz von außerhalb.","en":"Secure off-campus network access."}', 'https://vpn.example.edu',   'https://docs.example.edu/vpn',     'shield', '{"remote access","fernzugriff"}', NULL),
  ('Webmail',  '{"de":"Universitäts-E-Mail im Browser.","en":"University email in your browser."}',               'https://webmail.example.edu', 'https://docs.example.edu/mail',    'mail', '{}', NULL),
  ('BigBlueButton', '{"de":"Web-Konferenzen und Vorlesungsaufzeichnung.","en":"Web conferencing and lecture recording."}', 'https://bbb.example.edu', 'https://docs.example.edu/bbb', 'video', '{"video conference","videokonferenz","online meeting","webinar","bbb"}', NULL),
  ('Identitätsmanagement', '{"de":"Passwort ändern und Konto verwalten.","en":"Change your password and manage your account."}', 'https://idm.example.edu', 'https://docs.example.edu/account', 'key-round', '{}', NULL),
  ('WLAN an der UOS', '{"de":"So verbindest du dich mit eduroam.","en":"How to connect to eduroam."}', NULL, 'https://docs.example.edu/wifi', 'wifi', '{wifi,internet}', NULL),
  ('Zettelkasten Labor', '{"de":"Experimentelles KI-Notizbuch für Forschungsnotizen.","en":"Experimental AI notebook for research notes."}', 'https://zettelkasten-lab.example.edu', 'https://docs.example.edu/zettelkasten', 'flask-conical', '{"notizen","notebook","ki"}', 'beta'),
  ('Serververwaltung', '{"de":"Verwaltung der Server im Rechenzentrum.","en":"Data-centre server management."}', 'https://srv.example.edu', NULL, 'server', '{"server","rechenzentrum"}', NULL),
  ('Team-Notizen', '{"de":"Interne Notizen des Dashboard-Teams.","en":"Internal notes of the dashboard team."}', 'https://notes.example.edu', NULL, 'notebook-pen', '{"notizen","notes"}', NULL)
on conflict (name) do update set keywords = excluded.keywords, tag = excluded.tag;

-- Category attachments (by name/slug, so this stays readable).
insert into service_categories (service_id, category_id)
select s.id, c.id from services s, categories c where (s.name, c.slug) in (
  ('Stud.IP', 'learning'), ('Stud.IP', 'teaching'),
  ('MyShare', 'data'),
  ('VPN', 'data'),
  ('Webmail', 'communication'),
  ('BigBlueButton', 'teaching'), ('BigBlueButton', 'communication'),
  ('Identitätsmanagement', 'identity'),
  ('WLAN an der UOS', 'data'),
  ('Zettelkasten Labor', 'ai-tools'),
  ('Serververwaltung', 'it-infra'),
  ('Team-Notizen', 'dash-team')
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
