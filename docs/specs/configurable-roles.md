# Spec — Configurable role set (roles derive from the claim mapping)

Status: **ready to implement** · Owner: supervisor session · Written 2026-08-28
Pre-launch (M4) — must land **before** production data exists and **before** the
migration flatten (`docs/specs/flatten-migrations.md`), which then absorbs it.
Run with: **opus, new session off `main`.**

## 1. Why

The role set is hardcoded to `student|teacher|staff` (DB check constraints in
migrations 00001/00002/00007, comments in `internal/auth/resolve.go`, TS types,
two admin components). The UOS IdM can only distinguish **student vs employee**,
so the fixed triple doesn't match the launch deployment — and any other adopter
has yet another set. Roles must become **data derived from the OIDC claim
mapping** (golden rule 8: nothing institution-specific in code), with the number
of roles scaling to the mapping.

## 2. Design

### 2.1 The role set comes from the config
The existing `oidc.role` block stays the single source of truth. The configured
role set := distinct values of `role.values` ∪ `role.precedence` ∪ `{role.default}`.
No separate role list to keep in sync. New optional display labels:

```yaml
oidc:
  role:
    values:            # claim value -> role slug (this defines the roles)
      student:  student
      employee: staff
    precedence: [staff, student]
    default: student
    labels:            # optional; fallback = capitalized slug in both languages
      student: { de: "Studierende", en: "Students" }
      staff:   { de: "Mitarbeitende", en: "Staff" }
```

- **Slug validation at config load** (fail startup on violation): lowercase
  `[a-z0-9-]{1,32}`, `all` is reserved (announcement audience).
- **Warning, not error, above 5 roles**: log at WARN that the product's UX
  (default views, audience picker) is designed for a handful of roles. Exactly
  the user's requirement — scale automatically, warn past 5.
- Shipped defaults remain the current three-role example so existing dev/test
  configs keep working unchanged.

### 2.2 Database: constraints move to the service layer
Migration 00016 drops the three check constraints (`users.primary_role`,
`role_defaults.role`, `announcements.audience` — `click_events`/`usage_daily`
`user_role` are already free text). Validation against the *configured* set
happens where all validation lives: `/internal/service` (CLAUDE.md rule 3), for
both HTTP and MCP paths. Rationale in the migration comment: the role set is
deployment config, and a config-time set can't be a schema-time constraint.

Graceful degradation for stale data (config changed, rows remain):
- `users.primary_role` not in the set → treat as `role.default` at read time;
  it self-heals on next login (roles re-resolve every login already).
- `role_defaults` rows for unknown roles → ignored at read, purged on next
  write of that role's list.
- `announcements.audience` unknown → the announcement is shown to no one but
  still listed (flagged) in the admin view, never an error.

### 2.3 API: expose the configured roles
`GET /api/roles` (session-required): `[{slug, label: {de, en}}]` in precedence
order. Consumed by the two admin components; `all` is added client-side for the
audience picker. `/api/me` keeps returning the user's resolved `primary_role`
slug.

### 2.4 Frontend
- `Me['primary_role']` and friends become `string` (no union type).
- `RoleDefaultsAdmin` renders one tab/section per role from `/api/roles`
  (labels, active-locale). `AnnouncementsAdmin`'s audience picker = `all` +
  roles. Both must stay viewport-clean at 324px with 5+ roles (wrap, don't
  overflow — the >5 warning exists because this is where it hurts).
- Role default views (`/api/catalog/defaults`) already key by role string.

### 2.5 Out of scope
Multi-role users beyond the existing precedence pick; per-role theming;
role-scoped catalog visibility (that's issue #36's territory).

## 3. Tests
- Config: set derivation (values ∪ precedence ∪ default), slug validation
  failures, the reserved `all`, the >5 WARN (assert the log), labels fallback.
- Resolution: table-driven two-role UOS shape (student/employee→staff),
  precedence, default; existing tests updated, not deleted.
- Service: writes rejecting roles outside the configured set (HTTP + MCP);
  stale-data degradation paths from §2.2.
- Integration: migration drops constraints; a 2-role config round-trips login →
  defaults → announcement audience.
- e2e: admin role-defaults + announcement audience against the dev config;
  viewport-clean with the seeded roles.
- Docs: 01 §3, 02 §4/§6, config.example.yaml (two-role UOS example + labels),
  README claim-mapping section.

## 4. Definition of done
- A deployment configured with only `student`/`staff` shows exactly two roles
  everywhere (admin editors, audience picker); one with six roles works and
  logs the WARN once at startup.
- No `student|teacher|staff` literal remains in Go/TS code or new SQL (dev
  seed/config keep them as the example deployment's data).
- Full gates green; `docs/specs/flatten-migrations.md` note added that 00016 is
  part of the future flatten.
