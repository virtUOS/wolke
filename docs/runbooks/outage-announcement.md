# Runbook: post and retire an outage announcement

Who: any admin user. Announcements are a singleton — **at most one is active at
a time.** Publishing a new one automatically retires whatever is currently
active (its `ends_at` is stamped to "now" and it moves into history; it is not
deleted). Source: `internal/service/announce.go` (`CreateAnnouncement`),
`internal/server/announce.go`, `web-ui/src/components/admin/AnnouncementsAdmin.tsx`.

> **MCP gap:** there is currently **no MCP tool for announcements.** The admin
> MCP server (`cmd/mcp`) only exposes `service.*`/`category.*`/`search.insights`
> and the `propose_*`/`change.confirm` staged-write flow for **catalog
> services** — nothing announcement-shaped. Announcements can only be managed
> through the admin web form / `POST|PATCH|DELETE /api/admin/announcements*`
> today. If you need to publish an announcement programmatically, use the HTTP
> API directly (steps below work with `curl` + your session cookie) — there is
> no staged propose→confirm step for this because there's no MCP path to stage.

---

## A. Post an outage announcement (form UI)

1. Log in as an admin and open **Administration → Announcements**.
2. If an announcement is already showing, note that creating a new one will
   silently retire it into history — that's expected, not a bug.
3. Click **New Announcement**.
4. Fill in the form (all four text fields are required; the form won't submit
   without them):
   - **Title (DE)** — required
   - **Title (EN)** — required
   - **Text (DE)** — required (multi-line body)
   - **Text (EN)** — required
   - **Severity** — `info` / `warning` / `critical`. Pick `critical` for a real
     outage: critical announcements cannot be dismissed by users (the
     dismiss button is suppressed, and the server also refuses a dismiss
     call for a critical notice even if someone forges one).
   - **Audience** — `all` / `student` / `teacher` / `staff`. Defaults to `all`.
   - **Ends At** — optional. Leave blank for "until manually retired/edited".
     If set, the banner stops showing itself automatically once that time
     passes (still visible in history). There is no "Starts At" field in the
     form — a new announcement is active immediately on publish.
   - **Dismissible** — checkbox, defaults on. Turn off to force everyone to
     keep seeing it (still subject to the critical-severity override above).
5. Click **Publish**.
6. Verify: the banner section now shows your new announcement with its
   severity badge; `GET /api/announcements` (what the SPA banner reads) should
   return it for an affected user's role.

## B. Retire an announcement early (form UI)

There is no dedicated "Retire" or "End now" button. Two ways to end it before
its natural `ends_at`:

1. **Edit and shorten it** (keeps it as history): Administration →
   Announcements → **Edit** → set **Ends At** to now (or any past time) →
   **Save**. This is the closest thing to an explicit "retire" action.
2. **Delete it outright** (removes the row and any per-user dismissal
   records for it — this is a hard delete, not a soft one): Administration →
   Announcements → **Delete** → confirm in the dialog. Use this only if the
   announcement should disappear from history too (e.g. it was posted in
   error).
3. Alternatively, simply **publish a new announcement** (even a trivial
   "all clear" `info` one) — that automatically retires the current one as a
   side effect.

## C. Post / retire via the HTTP admin API directly (no MCP path exists)

Useful mid-incident if the SPA itself is part of the outage. Requires an
authenticated admin session cookie (log in via the browser first and reuse
the `sh_session` cookie, or script the OIDC login).

Create/publish:

```bash
curl -sS -X POST "$PUBLIC_URL/api/admin/announcements" \
  -H "Content-Type: application/json" \
  -b "sh_session=$SESSION_COOKIE" \
  -d '{
    "title": {"de": "Störung: VPN nicht erreichbar", "en": "Outage: VPN unreachable"},
    "body": {"de": "Wir arbeiten an der Behebung.", "en": "We are working on a fix."},
    "severity": "critical",
    "audience": "all",
    "ends_at": null,
    "dismissible": false
  }'
```

Retire early (PATCH the id returned above, e.g. shorten `ends_at`):

```bash
curl -sS -X PATCH "$PUBLIC_URL/api/admin/announcements/$ID" \
  -H "Content-Type: application/json" \
  -b "sh_session=$SESSION_COOKIE" \
  -d '{ "..." : "...", "ends_at": "2026-08-28T12:00:00Z" }'
```

Note `PATCH` replaces the full record (`title`, `body`, `severity`,
`audience`, `starts_at`, `ends_at`, `dismissible` are all required in the
body) — it is not a partial patch, so re-send the unchanged fields too. Or
just delete it:

```bash
curl -sS -X DELETE "$PUBLIC_URL/api/admin/announcements/$ID" \
  -b "sh_session=$SESSION_COOKIE"
```

## D. Confirm it's audited

Every create/update/delete via the form writes an `audit_log` row with
`actor_kind = "form"` and action `announcement.create` / `announcement.update`
/ `announcement.delete`. Check **Administration → Audit** in the SPA, or:

```bash
curl -sS "$PUBLIC_URL/api/admin/audit?limit=20" -b "sh_session=$SESSION_COOKIE"
```
