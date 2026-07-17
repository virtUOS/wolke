# 01 — Product Concept

## 1. The product in one sentence

An authenticated, role-aware portal where every member of Universität Osnabrück lands on a
dashboard pre-arranged for *their* kind of work, finds any IT service or its documentation
in seconds, and keeps the handful they use daily one tap away.

## 2. Why it exists (the job)

The university runs dozens of IT services scattered across subdomains, wikis, and PDFs.
Today people bookmark what they can find and ask colleagues for the rest. The hub replaces
that with a single, trustworthy front door:

- **Find** — search or browse by category, get a one-line description, and go.
- **Learn** — every entry links to in-depth documentation (hosted elsewhere), and some
  entries are *documentation only* (e.g. "How Wi-Fi works at UOS") with no service behind them.
- **Keep** — pin frequent services as favorites for one-tap access.
- **Stay informed** — announcements surface outages and major changes at the top.

It is deliberately **not** a status page (no up/down indicators), not a documentation host,
and not an SSO replacement (Keycloak already is that). It is a *launcher and catalog*.

## 3. Users and the role model

Three audiences, each with a different **initial default view** that an admin curates and
the user can then personalize:

| Role | Typical first need | Default view emphasis |
|------|--------------------|-----------------------|
| **Student** | learning, exams, Wi-Fi, account | Lernmanagement, Identifizierung, Netz & Daten |
| **Teacher** | teaching tools, recordings, collaboration | Teaching, Lernmanagement, AI tools, Writing |
| **Staff** | administration, communication, data | Administration, Communication, Netz & Daten |

Role comes from **OIDC claims** (see doc 02). A user may legitimately hold more than one role
(a PhD student who also teaches); the system picks a primary role for the default view but the
user can switch and personalize freely. **Admin** is a separate, orthogonal flag derived from a
group claim — an admin is still a student/teacher/staff member for their normal view.

> **Decision to confirm:** the exact claim that distinguishes student/teacher/staff, and the
> rule when someone has several. Default assumption: a `eduPersonAffiliation`-style claim,
> with a fixed precedence (teacher > staff > student) for choosing the primary view.

## 4. The core UX

The Figma/PDF concept is sound; this formalizes it.

### 4.1 Navigation
A persistent top bar: **UOS logo + "IT Service"** on the left; two primary tabs — **Services**
and **Favorites**; on the right, the **theme toggle**, **list/table view toggle**, and **search**.
The active tab stays visually highlighted (the "must remain highlighted" requirement from the PDF).
On mobile this collapses: tabs become a bottom or segmented control, search expands to full width.

### 4.2 The tile (the signature component)
Each service is a **two-zone tile** — this is the one interaction worth getting exactly right:

```
┌─────────────────────────────────────┐
│  MyShare                        ☆    │  ← TOP ZONE: click = open the service
│  Datenverwaltung                     │     in a new tab. (For doc-only entries,
│                                      │     this zone opens the documentation.)
├─────────────────────────────────────┤
│  ▼ More details                      │  ← BOTTOM ZONE: click = expand/collapse
└─────────────────────────────────────┘     the description in place. Never navigates.
```

Expanded, the tile reveals the short description plus a **Documentation** link. The star
toggles favorite. States to design: default, hover, focus-visible, collapsed, expanded —
in both light and dark. The clean separation of *launch* vs *explore* is the product's
clearest usability idea; keep it crisp.

### 4.3 Two browse layouts
- **List** — single column of full-width tiles grouped by category. The mobile default.
- **Table** — multi-column masonry of compact tiles grouped by category. The desktop default.

A toggle in the top bar switches between them; the choice persists per user.

### 4.4 Favorites
Favorites are a **flat per-user set** — no named lists. Tapping the star on a tile toggles the
service as a favorite (one tap, no dialog); tapping again removes it. The Favorites tab shows the
user's favorited services, grouped by category, alongside the "frequently used" strip (§4.5).

> **Decision (supersedes the earlier Figma mockup):** the named-lists idea ("Täglicher Gebrauch",
> "+ Neue Liste", a default list, add-to-list dialog) was dropped. Keep favorites a single flat set.

### 4.5 "Frequently used"
A surfaced section (top of Favorites, or its own strip on the Services page) showing the user's
most-clicked services over a rolling window. This is **derived from click tracking** (§5.4), not
something the user curates. It answers "take me back to what I was just using."

### 4.6 Search
Always reachable from the top bar. Searches name, description, category, and per-service
**keywords** — admin-configured search aliases (a flat, language-agnostic list, e.g.
`video conference` → BigBlueButton) that surface a service even when the term appears in
neither its name nor its description. Fuzzy/prefix matching, results grouped by category,
keyboard-navigable. On a result, the same tile behavior applies. Search runs server-side
(`/api/search`, debounced) — the single search path. Search is a **must-have**, so it ships
in Phase 1, not later.

**Zero-result insights.** Every query is logged with its result count (aggregate-only — the
normalized query text and a count, never a user id). An admin view lists recent searches that
returned **nothing**, ranked by frequency — the worklist that tells admins which keywords to add,
and the proof a fix worked (the query stops showing up empty). This closes the loop: keywords are
the lever, the zero-result list is the dial that says which lever to pull.

### 4.7 Announcements
A dismissible banner region at the top of the dashboard for outages and major notices.
Each announcement has a severity (info / warning / critical), an optional time window
(auto-expire), and an audience (all, or scoped to a role). Critical ones are not dismissible
until resolved. Admins create them (form + MCP).

**One active at a time, with a history.** At most one announcement is active at once;
creating a new one *retires* the current active one (ends its window now) rather than
deleting it. Past notices — expired or dismissed — are kept and reachable from a
**notification center** (the bell in the top bar), which lists the active notices above
the user's history. Retired notices are purged permanently after a server-configured
retention window (`announcement_retention_days`, default 60 days from `starts_at`; `0`
disables purging). Only expired notices are purged, so an active banner is never removed
regardless of age.

## 5. Features resolved into behavior

### 5.1 The catalog changes over time
Services are added/removed monthly by admins. Removal is a **soft delete** (hidden, not purged)
so favorites and metrics referencing it degrade gracefully — a removed favorite shows as
"no longer available" rather than vanishing or erroring. Every catalog edit is **audit-logged**
(who, what, when, via form or MCP).

### 5.2 Categories
A service has **one or more** categories from a managed set (teaching, learning, communication,
administration, writing, AI tools, support — extensible by admins). Categories drive grouping,
filtering, search, and the role default views. Doc-only entries are categorized too.

### 5.3 Service vs documentation links
Every entry has: a short description, an optional **service URL**, and a **documentation URL**.
- If `service_url` is set → top zone launches the service; expanded tile also shows the doc link.
- If `service_url` is empty → it's a **doc-only entry**; the top zone opens the documentation,
  and the tile is visually marked as informational (e.g. a book/file icon instead of launch).

Documentation is always external and out of scope to host or render.

### 5.4 Usage tracking (powers both "frequently used" and metrics)
A click on a tile fires a lightweight tracked event: `{service_id, user_role, target,
timestamp}`, where `target` is the launch link or the secondary documentation link. The user's
own launch counts feed "frequently used"; aggregate counts by service, role, and target feed the
Prometheus metrics (doc 02 §7). No third-party analytics; data stays in Postgres.

> **Privacy note:** per-user counts are needed for "frequently used" but the *exported* metrics
> are aggregate-only (per service, per role) — never per identifiable user. State this in the
> privacy notice; coordinate with the DSB (Datenschutzbeauftragte).

### 5.5 Admin editing — two paths, same guardrails
- **Form view** (admins only): create/edit/remove services and announcements, manage categories,
  edit descriptions. Standard CRUD with validation and a confirm step on destructive actions.
- **MCP server** (admins only): an admin chats with an assistant ("add the new VPN replacement,
  category Netz & Daten, here's the URL and docs"); the MCP server proposes the change and
  returns a **preview/diff**; nothing is written until the admin issues an explicit
  **confirm**. Same validation, same audit log as the form. Details in doc 02 §8.

### 5.6 Theming
Light and dark mode, system-preference by default, user toggle persists. Palette derived from
the UOS corporate design (doc 03).

## 6. Explicit non-goals
- No service status/health monitoring or up/down badges.
- No hosting or rendering of documentation content.
- No replacement of Keycloak/identity; the hub only consumes OIDC.
- No public/unauthenticated view — login is always required.
- (v1) No second "service-info chatbot" MCP — noted as a future addition, designed for but not built.

## 7. Success criteria
- A first-time student reaches "open my most relevant service" without scrolling past
  irrelevant categories — the role default earns its keep.
- Search returns the right service for a known name in < 1s and ≤ 2 keystrokes-of-thought.
- An admin adds a service end-to-end (form or MCP) in under two minutes, with a preview.
- The dashboard is fully usable on a phone with one thumb.
- Cold page load feels instant on campus Wi-Fi; catalog reads are cache-served.

## 8. Open decisions to confirm (the "holes")

> Note: the hub is built to be reused as open-source (configurable OIDC + branding). So most of
> these are now **config values for the UOS default deployment** rather than code decisions — a
> fork answers them differently in its own `branding.yaml` / claim-mapping / Compose files.

1. **Brand assets** — exact primary/secondary/neutral hex values from the UOS Corporate Design
   manual, plus logo (light/dark) and favicon, to populate the default `branding.yaml` (doc 02 §11).
   Doc 03 uses values read from the mockups as placeholders.
2. **Role claim** — which OIDC claim carries affiliation at the UOS IdP, its possible values, and
   the precedence rule for multi-role users → fill the `oidc.role` mapping (doc 02 §6).
3. **Admin claim** — the exact group/role value (e.g. `dashboard-admins`) and which claim it lives
   in → fill the `oidc.admin` mapping (doc 02 §6).
4. **Hosting specifics** — Postgres as a Compose service vs managed; Caddy hostname/cert setup;
   `PUBLIC_URL`. Single instance is the default; multi-instance + Redis only if HA is required (doc 02 §9).
5. **Default views ownership** — are role defaults curated centrally by admins, or generated
   from category-to-role mappings? (Recommendation: admin-curated ordered lists per role,
   editable in the admin form.)
6. **Favorite-list limits** — any cap on number of lists / items per user? (Default: soft cap, e.g. 20 lists.)
7. **Announcement audience granularity** — role-level only, or also by category/faculty? (Default: role-level.)
8. **Localization** — German only, or German + English? The catalog data and UI strings should
   assume i18n from the start even if you ship German first. (Default: build i18n-ready, ship `de`.)
9. **Data retention** — how long to keep raw click events before rolling up/discarding? (Default:
   keep aggregates indefinitely, raw events 90 days.)
10. **MCP transport/host** — where the admin MCP server runs and which chat client connects to it
    (Claude Desktop, Claude Code, an internal tool). Affects auth wiring; see doc 02 §8.
