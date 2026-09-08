# Spec — Service visibility: experimental opt-in (#34) and claim-gated groups (#121)

Status: **READY TO IMPLEMENT — all decisions settled (§7). Stage 1 first.**
Owner: supervisor session · Written 2026-09-08, simplified 2026-09-08 (no tabs, relaxed
confidentiality — see §1.1)
Issues: **#34** (experimental mode, stakeholder request), **#121** (visibility groups),
**#36** (group-scoped categories — subsumed, see §6).

## 1. Why one feature and not two

Both issues ask the same question of the read model — *may this user see this service?* —
and differ only in **who decides** and **how it is shown**:

| | #34 experimental | #121 groups (IT infrastructure) |
|---|---|---|
| Who grants access | the user, opting in | the IdP, via a claim |
| Confidentiality | none — not secret, just off by default | hidden, not classified (§1.1) |
| Display | inline in the normal views, clearly labelled | inline too (§1.1) |
| Extra requirement | warning at opt-in ("data may vanish, no migration") | Keycloak group mapper docs |

### 1.1 Two simplifications (user decision, 2026-09-08)

**No tabs — everything renders inline.** A restricted service sits in an ordinary category
alongside everything else; non-holders simply never see it, so the category appears empty and
drops out for them. This removes the `display` axis from the config, the per-group tab, and the
mobile tab-strip work at 324px — which was the riskiest UI in the whole feature.

**Confidentiality is "hidden", not "classified".** The bar is *other users do not see these
services*, not *a determined user cannot prove they exist*. Note this changes the design less
than it sounds: because every read surface funnels through one seam (§3), filtering them all
costs the same either way. What it relaxes is the edge-case surface — a favourite of a service
that later became invisible, or a search result count, need care but not paranoia. Recommendation
kept regardless: the compile-time-safe snapshot type in §3 is an hour's work and rules out a
whole class of future leak, so build it even at the lower bar.

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
  - slug: experimental
    label:   { de: "Experimentell", en: "Experimental" }
    grant:   opt-in                    # the user enables it in the account menu
    warning: { de: "Experimentelle Dienste können jederzeit ohne Vorankündigung
                    verschwinden; Daten gehen dabei möglicherweise verloren und
                    werden nicht migriert.",
               en: "Experimental services can disappear at any time without notice;
                    data may be lost and will not be migrated." }
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

**`VisibleTo` must narrow categories too.** `/api/catalog` returns `categories` as its own list,
and the SPA renders the category filter pills straight from it (`Dashboard.tsx`). Without
narrowing, a non-holder would see an empty "IT-Infrastruktur" pill that filters to nothing —
leaking the name and offering a dead control. Dropping categories with no visible service for
this user is what produces the "invisible category" effect, and it is three lines in the same
seam.

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
- **Claim flavour (#121)**: no UI of its own. Held services appear inline in the normal views
  and search exactly like public ones (badged with the slug's label, same as the opt-in flavour);
  their category renders for holders and disappears for everyone else. No tab, no tab strip, no
  new viewport states — the difference from #34 is purely *who* holds the slug.
- **Admin**: the service form and the MCP propose path get a visibility selector
  (Öffentlich / each configured label). Admins always see everything in the admin views.
- `/api/me` exposes the held set (the UI needs it for tabs and the toggle state).

## 6. Relationship to #36

#36 (group-scoped *categories*) is satisfied in substance by per-service visibility plus its
tab: "RZ infrastructure" becomes a slug, not a category. Its only genuine remainder is
**invite-based** membership (neither claim nor self-serve), which this spec does not cover.
Close #36 as subsumed when this ships, or keep it open narrowed to invites.

## 7. Decisions (settled 2026-09-08)

1. **`role_defaults` may not reference a restricted service.** Default views stay public-only:
   validated in `/internal/service` on the role-defaults write path (reject with a field error
   naming the service), and the admin role-defaults picker only offers public services. Keeps
   every role's default view identical for every user of that role.
2. **Announcement audiences stay role-based.** No per-visibility-slug audience in v1.
3. (Moot with the no-tabs simplification: holders see restricted services inline, everywhere —
   normal views and search alike.)

## 8. Delivery in two stages, one mechanism

**Stage 1 — core + #34 (the stakeholder request).** Migration, config block with both grant
types validated, `VisibleTo` seam + all read surfaces + MCP, admin write path, opt-in toggle with
the warning dialog, inline badge, `/api/me`. Ships experimental mode end to end; the claim
plumbing is present but unused until a deployment configures a `grant: claim` entry.

**Stage 2 — #121's claim grants.** Claim-derived membership recomputed at login (the `is_admin`
pattern), Keycloak group-mapper docs, admin runbook. **No UI work at all** — Stage 1 already
renders held services inline; Stage 2 only adds a second way to hold a slug.

Building Stage 1 to Stage 2's confidentiality standard from the start is the point: #34 alone
would tolerate a leak, #121 would not, and the second one to arrive must not require reworking
the first.

## 9. Estimate

| | Combined, simplified (this spec) | Separately, with tabs |
|---|---|---|
| Stage 1 / #34 | 1–1.5 sessions (opus) | ~2 sessions |
| Stage 2 / #121 | 0.5–1 session (opus) | ~2 sessions + rework of #34's filter |
| **Total** | **2–2.5 coding sessions** | **4+, with two divergent filter paths** |

Dropping the tabs took roughly a session out of Stage 2 (tab strip, mobile 324px states, per-tab
e2e) and simplified the config. The bulk of Stage 1 remains the test surface — one "non-holder
cannot see it" test per read surface — not the feature code. The riskiest half hour is still the
compile-time-safe snapshot type.

## 10. Definition of done

- No configured visibility entries → byte-identical behaviour to today (regression test).
- Per read surface, a test proving a non-holder cannot obtain a restricted service — catalog,
  defaults, search, favourites, frequent, click, catalog MCP.
- Opt-in flow: toggle + warning dialog, services appear/disappear, badge visible, e2e at the full
  viewport matrix.
- Claim flow: membership re-derived at login; revoking the group revokes access at next login;
  a held service renders inline for holders and its category vanishes for everyone else.
- Docs: `config.example.yaml`, docs/01 §3/§5, docs/02 §4/§6/§8/§9, Keycloak guide, admin runbook.
- Full gates incl. `make e2e`.
