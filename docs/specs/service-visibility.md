# Spec — Service visibility: experimental opt-in (#34) and claim-gated groups (#121)

Status: **PLANNED — awaiting go-ahead and the three open decisions in §7.**
Owner: supervisor session · Written 2026-09-08
Issues: **#34** (experimental mode, stakeholder request), **#121** (visibility groups),
**#36** (group-scoped categories — subsumed, see §6).

## 1. Why one feature and not two

Both issues ask the same question of the read model — *may this user see this service?* —
and differ only in **who decides** and **how it is shown**:

| | #34 experimental | #121 groups (IT infrastructure) |
|---|---|---|
| Who grants access | the user, opting in | the IdP, via a claim |
| Confidentiality | none — not secret, just off by default | **required** — a non-member must not learn it exists |
| Display | inline in the normal views, clearly labelled | its own tab |
| Extra requirement | warning at opt-in ("data may vanish, no migration") | Keycloak group mapper docs |

Building them separately means two service-level markers, two per-user membership notions, two
filter implementations across the same six read surfaces, and two test suites — then a merge
when the second lands. Worse, two filtering paths is exactly the shape of bug that leaks a
hidden service. **One mechanism, two flavours** is both less work and safer.

## 2. The model

A **visibility slug** marks a service as non-public. A user's **visible set** is
`{public} ∪ {slugs the user holds}`. A slug is held either because a claim granted it or
because the user opted in — that is the only difference between the two features.

```yaml
# config.yaml — provider-agnostic, validated at startup like oidc.role (docs/specs/configurable-roles.md)
visibility:
  - slug: it-infra                     # [a-z0-9-]{1,32}; must not collide with a role slug or 'all'
    label:   { de: "IT-Infrastruktur", en: "IT infrastructure" }
    grant:   claim                     # membership comes from the IdP
    claim:   groups                    # nested paths supported, like oidc.admin.claim
    match:   it-service-admins
    display: tab                       # own tab next to Favoriten/Dienste
  - slug: experimental
    label:   { de: "Experimentell", en: "Experimental" }
    grant:   opt-in                    # the user enables it in the account menu
    warning: { de: "Experimentelle Dienste können jederzeit ohne Vorankündigung
                    verschwinden; Daten gehen dabei möglicherweise verloren und
                    werden nicht migriert.",
               en: "Experimental services can disappear at any time without notice;
                    data may be lost and will not be migrated." }
    display: inline                    # in the normal views, with the label as a badge
```

No configured entries → **zero behaviour change**, every service public, no new UI anywhere.

## 3. The one thing that makes this cheap

Every user-facing read surface already resolves service data through the catalog snapshot —
verified 2026-09-08:

| Surface | How it resolves |
|---|---|
| `/api/catalog` | `snap.Services` |
| `/api/catalog/defaults` | ids → `snap.ServiceByID` |
| `/api/search` | `SearchServiceIDs` returns **ids** → `snap.ServiceByID` |
| `/api/favorites` | ids → `snap.ServiceByID` |
| `/api/usage/frequent` | ids → `snap.ServiceByID` |
| `POST /api/events/click` | `snap.ServiceByID` (metric label) |
| catalog MCP (`internal/readmcp`) | `snap.Services` / `ServiceByID` |

So filtering lands in **one seam**, not in six SQL queries: `Snapshot.VisibleTo(held []string)`
returning a narrowed snapshot. Search needs no SQL change — a restricted id simply fails to
resolve, and the result count follows.

**Make filtering non-optional by construction.** The narrowed snapshot should be the only type
the handlers can consume (e.g. `cache.Get` yields a raw snapshot whose service accessors are
unexported, with `VisibleTo` the sole way to obtain a readable view). A future handler that
forgets to filter must fail to compile, not leak. This is the single most important design
decision here — worth the extra hour.

## 4. Data model

- Migration (next free number): `alter table services add column visibility text` — NULL =
  public (today's behaviour). One slug per service in v1; a m2m table is a compatible later
  extension. Validated in `/internal/service` against the configured slugs, shared by the form
  and MCP write paths, audited like any catalog write.
- `users.visibility_claims text[] not null default '{}'` — recomputed **on every login**, like
  `is_admin`, so revoking the IdP group revokes access at next login.
- `users.visibility_optin text[] not null default '{}'` — the user's own choices.
- Effective held set = `visibility_claims ∪ visibility_optin`, each filtered to slugs that still
  exist in config **and whose `grant` type matches the source** — so flipping a slug from
  `opt-in` to `claim` in config cannot leave self-granted access behind.

## 5. Behaviour

- **Non-holders**: a restricted service is absent from catalog, defaults, search, favourites and
  frequently-used — no existence oracle anywhere. A favourite that becomes invisible degrades
  like a soft-deleted one.
- **Catalog MCP** (no identity) sees **public only**, unconditionally — keep the compile-time
  least-privilege property of `internal/readmcp` true.
- **Opt-in flavour (#34)**: a toggle in the account menu (precedent: `favorites_separate_tab`),
  gated behind a confirm dialog carrying the configured `warning` text. Services appear inline in
  the normal views with the slug's label as a badge — reuse the tile's existing status-label slot
  (`services.tag` styling), no new tile anatomy. Turning it off hides them again; nothing is lost.
- **Tab flavour (#121)**: one extra tab per held `display: tab` slug, labelled from config.
  The mobile tab strip must stay viewport-clean with three or four tabs at 360/390 and pass at
  324 (CLAUDE.md) — the known risk of this half.
- **Admin**: the service form and the MCP propose path get a visibility selector
  (Öffentlich / each configured label). Admins always see everything in the admin views.
- `/api/me` exposes the held set (the UI needs it for tabs and the toggle state).

## 6. Relationship to #36

#36 (group-scoped *categories*) is satisfied in substance by per-service visibility plus its
tab: "RZ infrastructure" becomes a slug, not a category. Its only genuine remainder is
**invite-based** membership (neither claim nor self-serve), which this spec does not cover.
Close #36 as subsumed when this ships, or keep it open narrowed to invites.

## 7. Open decisions (settle at kickoff)

1. For a **holder**, does a restricted service also appear in the normal views and search, or
   only in its tab? (Proposal: everywhere — the restriction is about non-holders. Note this
   makes `display` purely additive: `tab` adds a tab, `inline` does not.)
2. May `role_defaults` include restricted services? (Proposal: **no** — default views stay
   public-only; simpler, and avoids a default view that differs per holder.)
3. Announcement audiences per visibility slug? (Proposal: out of scope v1.)

## 8. Delivery in two stages, one mechanism

**Stage 1 — core + #34 (the stakeholder request).** Migration, config block with both grant
types validated, `VisibleTo` seam + all read surfaces + MCP, admin write path, opt-in toggle with
the warning dialog, inline badge, `/api/me`. Ships experimental mode end to end; the claim
plumbing is present but unused until a deployment configures a `grant: claim` entry.

**Stage 2 — #121's tab.** Claim-derived membership at login, the extra tab per held slug and its
mobile strip work, Keycloak group-mapper docs, admin runbook.

Building Stage 1 to Stage 2's confidentiality standard from the start is the point: #34 alone
would tolerate a leak, #121 would not, and the second one to arrive must not require reworking
the first.

## 9. Estimate

| | Combined (this spec) | Separately |
|---|---|---|
| Stage 1 / #34 | 1–2 sessions (opus) | ~2 sessions |
| Stage 2 / #121 | 1–1.5 sessions (opus) | ~2 sessions + rework of #34's filter |
| **Total** | **2.5–3.5 coding sessions** | **4+, with two divergent filter paths** |

The bulk of Stage 1 is the security test surface (one "non-holder cannot see it" test per read
surface), not the feature code. The riskiest half hour is the compile-time-safe snapshot type;
the riskiest UI is Stage 2's tab strip at 324px.

## 10. Definition of done

- No configured visibility entries → byte-identical behaviour to today (regression test).
- Per read surface, a test proving a non-holder cannot obtain a restricted service — catalog,
  defaults, search, favourites, frequent, click, catalog MCP.
- Opt-in flow: toggle + warning dialog, services appear/disappear, badge visible, e2e at the full
  viewport matrix.
- Claim flow: membership re-derived at login; revoking the group revokes access at next login.
- Docs: `config.example.yaml`, docs/01 §3/§5, docs/02 §4/§6/§8/§9, Keycloak guide, admin runbook.
- Full gates incl. `make e2e`.
