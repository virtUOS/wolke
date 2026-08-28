# Runbook: add / edit / remove a catalog service

Who: any admin user, via the web form or the admin MCP server. Both paths call
the same service-layer functions in `internal/service/admin.go`
(`CreateService`, `UpdateService`, `SoftDeleteService`), so validation and the
resulting data are identical either way — only the write mechanics differ.

**Removal is a soft delete only.** `DELETE /api/admin/services/{id}` (form) and
`service.propose_delete` → `change.confirm` (MCP) both set `is_active = false`;
they never `DELETE FROM services`. **There is no reactivate/undelete path
anywhere in the code** — no HTTP endpoint, no MCP tool, and editing an
inactive service does not flip `is_active` back to true (`UpdateService` in
`internal/service/admin.go` never touches that column). If you soft-delete a
service by mistake, the only way back today is to re-create it as a new row
(new id — any favorites or role-defaults pointing at the old id stay broken)
or to flip `is_active` back to `true` directly in Postgres. Treat "Delete" as
effectively permanent when deciding whether to use it.

---

## A. Add a service (form UI)

1. Log in as an admin → **Administration → Services → New Service**.
2. Fill in the form:
   - **Name** — required.
   - **Description (DE)** — required.
   - **Description (EN)** — required.
   - **Service URL** — the launch link. At least one of Service URL / Doc URL
     is required; a service with only a Doc URL is a documentation-only
     "service" (no launch button).
   - **Doc URL** — optional documentation link.
   - **Categories** — pick at least one (checkboxes); required.
   - **Keywords** — optional search terms, comma/Enter-separated chips. Max
     32 keywords, 50 characters each (enforced both client- and server-side).
   - **Status** — none / **beta** (blue badge) / **wartung** (amber
     "maintenance" badge). Optional.
   - **Icon** — pick a `lucide-react` icon by search; must be a valid
     kebab-case name from the allowlist (`internal/service/icons.go`).
3. Both URL fields, if filled, must be `http(s)://…` — invalid ones are
   rejected by both the form and the server.
4. Click **Create**. The list view now shows the new service; the tile
   preview on the right of the form shows how it will render.

## B. Edit a service (form UI)

1. **Administration → Services** → **Edit** on the target row (works for
   active and inactive services alike).
2. Change any field(s); same validation as create applies.
3. **Save**.

## C. Remove a service — soft delete (form UI)

1. **Administration → Services** → **Delete** (only shown for active
   services — an already-inactive one has no Delete button, since it's
   already removed).
2. Confirm in the dialog.
3. The service disappears from the public catalog/search immediately and
   shows an **Inactive** badge in the admin list. Favorites and click-metric
   history referencing it degrade gracefully rather than erroring.

## D. Add / edit / remove via MCP (staged propose → confirm)

The admin MCP server (`cmd/mcp`, tools registered in `cmd/mcp/main.go`) never
writes directly. Every mutating tool call is two steps:

1. **Propose** — `service.propose_create`, `service.propose_update`, or
   `service.propose_delete`. Validates the input with the same rules as the
   form and stages the change **in memory only** — nothing is written yet.
   Returns a `change_token`, the `action`, a `before`/`after` preview, and
   `expires_at`.
2. **Confirm or discard**:
   - `change.confirm { "change_token": "…" }` — performs the actual write
     (calls the same `CreateService`/`UpdateService`/`SoftDeleteService` the
     form uses) and audit-logs it. The token is consumed immediately and is
     single-use.
   - `change.discard { "change_token": "…" }` — abandons the staged change,
     nothing is written.

**Tokens expire after 10 minutes** (`TokenTTL` in `internal/adminmcp/adminmcp.go`)
and are held in the running MCP process's memory — a server restart also
discards any staged-but-unconfirmed changes.

Example: create a service.

```jsonc
// 1. propose_create
{
  "tool": "service.propose_create",
  "input": {
    "name": "VPN",
    "description_de": "Sicherer Zugang zum Hochschulnetz.",
    "description_en": "Secure access to the university network.",
    "service_url": "https://vpn.example.edu",
    "doc_url": "https://docs.example.edu/vpn",
    "icon": "shield",
    "categories": ["netzwerk"],
    "keywords": ["vpn", "network"]
  }
}
// → { "change_token": "...", "action": "service.create", "after": {...}, "expires_at": "..." }

// 2. change.confirm
{ "tool": "change.confirm", "input": { "change_token": "..." } }
```

Update and delete follow the same pattern — `service.propose_update` also
takes `id`, `service.propose_delete` takes just `id`, and both still require
`change.confirm` to actually write.

**Setup reminder:** the MCP server acts as one fixed admin, identified by
`MCP_ADMIN_SUB` (the OIDC `sub` of an admin who has logged into the web UI at
least once, so their user row exists). See the README's "Admin MCP server"
section for the full environment/launch config.

## E. Verify the write is real, not just staged

- `propose_*` alone must never change anything — if you're testing this
  runbook, confirm the service does **not** appear/change after a `propose_*`
  call and **does** after `change.confirm`. This invariant is enforced by
  `TestProposeNeverWritesConfirmDoes` in
  `internal/adminmcp/adminmcp_integration_test.go` — do not weaken it.
- Every confirmed write (form or MCP) lands in `audit_log` with
  `actor_kind = "form"` or `"mcp"` respectively, action one of
  `service.create` / `service.update` / `service.delete`, and a `diff`
  containing before/after JSON.

## F. Where the audit trail shows up

`GET /api/admin/audit` (last 100 by default, `?limit=N` up to 500) — and it
**does** have an admin-facing UI page: **Administration → Audit**
(`web-ui/src/components/admin/AuditLog.tsx`), a read-only, reverse-chronological
list showing timestamp, actor kind (`form`/`mcp`) badge, actor name (when
resolvable), the action, and a truncated target id. There is no filtering/
search UI on that page today — for anything beyond "scan the last 100–500
entries" you'll need to query `audit_log` directly in Postgres (see
`docs/runbooks/restore-postgres.md` for how to get a `psql` shell).
