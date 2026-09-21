# 03 — Design System

## 1. Design philosophy

This is a **utility people use under time pressure** — between lectures, on a phone, looking for
one specific thing. So the design ambition is not visual spectacle; it is **legibility, calm, and
zero friction.** The frontend-design instinct to "take a bold risk" is spent in exactly one place:
the **two-zone tile** (§5). Everything else stays quiet, spacious, and predictable. That restraint
*is* the design choice — a busy university launcher is the failure mode to avoid.

Concretely:
- **One accent.** The UOS bordeaux carries brand and signals interactivity. Neutrals do the rest.
- **Generous spacing, few borders.** Separation by whitespace and subtle elevation, not boxes-in-boxes.
- **Mobile-first.** Design the single-column phone layout first; the desktop table view is the enhancement.
- **The tile is the hero.** It is the most-repeated element on the page, so its hierarchy, states,
  and the launch/explore split must be flawless.
- **White-label by design.** The brand is *theme*, not structure: the single-accent palette, the
  logo, the product/org name, and the heading bar (§3) all come from runtime config (tech spec §11),
  never hardcoded. Build the layout so it holds with a different accent color and a different-shaped
  logo — UOS is the default skin, not an assumption.

## 2. Color tokens

> ⚠️ **These are the bundled *default* theme**, read from the Figma/PDF mockups. Two things:
> (1) lock the exact UOS values against the official Corporate Design manual before the UOS launch
> (concept §8.1); (2) per the white-labeling requirement (tech spec §11), these are **not
> compiled in** — they are the defaults a deployer overrides at runtime via `branding.yaml`. The
> SPA reads the active values from `GET /api/branding` on load and applies them as the CSS
> variables below. **Keep the variable names stable; only values change.** A fork re-skins by
> editing one file and swapping logo assets — no recompile.

Tokens are **semantic** (named by role, not by hue) so a skin re-colours by value alone. They split
into two classes by *who owns the value*:

**Brand-overridable palette** — served as two maps (`theme.light`, `theme.dark`) by `GET /api/branding`,
applied at runtime as CSS variables; `.dark` on `<html>` selects which map is live. These are what a
deployer changes in `branding.yaml`. Key names use `_` in the payload (`primary_hover`) and map to
`--primary-hover` CSS vars.

| Token (`--name`) | Light | Dark | Role |
|---|---|---|---|
| `--primary`        | `#A6093D` | `#C2355C` | brand + primary actions, active tab |
| `--primary-hover`  | `#8A0732` | `#A6093D` | primary pressed/hover |
| `--accent`         | `#F2C879` | `#F2C879` | the warm wash — segmented-control pill, tile hover, light canvas tint |
| `--favorite`       | `#F2C879` | `#F2C879` | the favourited-service state (the star) |
| `--surface`        | `#F4F4F5` | `#1E1E21` | page background behind cards |
| `--surface-2`      | `#ECECEE` | `#27272B` | tile footer / inset zones |
| `--border`         | `#E2E2E5` | `#34343A` | hairlines, dividers, card edges |
| `--text`           | `#18181B` | `#F4F4F5` | body text; the launcher watermark fill (#212) |
| `--text-muted`     | `#6B6B70` | `#9A9AA1` | sub-labels, secondary text |
| `--info`           | `#2563EB` | `#60A5FA` | informational state / banner |
| `--warning`        | `#B45309` | `#FBBF24` | warning state / banner |
| `--success`        | `#15803D` | `#4ADE80` | success state / confirmations |
| `--danger`         | `#B91C1C` | `#F87171` | destructive actions, critical state |

Announcement severities map onto these: `info`→`--info`, `warning`→`--warning`, `critical`→`--danger`.
Brand red (`--primary`) is for **brand + interaction only** — never large fills, or it stops meaning
"actionable"; `--danger` is the distinct true-red for destructive/critical, so the two don't blur.

`--accent` is **the warm wash and nothing else**: the active pill of a segmented control, the tile
hover border and background tint, and the light-mode canvas tint. It had accumulated unrelated jobs
— it was also the favourites star and the watermark fill — which meant retinting any one of them
repainted all five. The star left in issue #211, to `--favorite`; the watermark left in #212, to
`--text`, so a neutral mark stays neutral when the accent is re-skinned. Read the role column as
the whole list of what a token paints, and split rather than extend: a token that
drifts into meaning "the yellow, mostly" is how that knot formed the first time. `--favorite` is
named for the semantic state, not the glyph, so it survives the affordance ceasing to be a star.
Both default to the same value, so the split is a no-op until a deployer sets one.

The **typography tokens** (`--font-body`, `--font-display`) are brand-overridable too, but they are not
colours and not per-theme, so they sit in their own `branding.fonts` block rather than in these two
maps — see §3.

**Structural tokens** — *not* brand-overridable; defined statically in `index.css` and identical across
skins (a deployer re-colours, but doesn't restructure). They flip on `.dark` where it matters.

```css
--bg:        #FFFFFF;  /* .dark: #161618 — app canvas; deliberately not in the branding payload */
--radius-sm: 0.25rem;  --radius-md: 0.375rem;  --radius-lg: 0.5rem;   /* corner scale */
```

Type scale (rem, structural, mapped to Tailwind `fontSize`): `0.75 / 0.875 / 1 / 1.25 / 1.5 / 2 / 2.5`.
Spacing and elevation use Tailwind's default scales — no custom tokens (keep it boring).

## 3. Typography

**What ships.** One face, self-hosted: **Hanken Grotesk Variable**
(`@fontsource-variable/hanken-grotesk`, wght 100–900), bundled by Vite and imported in `main.tsx`.
No external font host — the strict CSP holds, nothing leaves the user's browser, and the PWA renders
offline. The open question this section used to carry ("confirm whether UOS mandates a corporate
typeface", Inter / Inter Tight / JetBrains Mono) is answered: the **UOS web corporate design permits
no serif face**, and the launcher uses a single grotesque for everything (issue #213). The serif
that once set the greeting (Newsreader) is gone, along with the second webfont on first paint.

**Two roles, two tokens** — brand-overridable like the colours (issue #214):

| token | default | role |
|---|---|---|
| `--font-body`    | `'Hanken Grotesk Variable', system-ui, -apple-system, sans-serif` | body and UI — set on `body`, inherited everywhere |
| `--font-display` | the same stack | the launcher greeting and the admin page title |

Same stack by default, so the split is a visual no-op: the display role is told apart by **weight and
size**, not by a second face (300 at 36px/27px, tracking −0.01em). That is what makes it survive a
deployer changing either family — the launcher still reads as a launcher whatever face it is given.

Unlike the colour tokens the font tokens are **not per-theme**: they live in `branding.fonts`, not in
`theme.light` / `theme.dark`. A skin re-colours across the two themes; it does not re-face. A `--font-mono`
role is deliberately absent until something actually renders in it (admin IDs/metrics would be the
case); adding one means adding it to `fontRoles` in `internal/config/config.go`, the `@theme inline`
bridge and the `:root` fallback — the same three places `--font-display` occupies.

**A deployer selects a family; it cannot supply a font file.** `branding.fonts.body` /
`.display` may name a bundled face or a system stack, and every stack must end in a generic family
(`sans-serif`, `system-ui`, …) or startup fails — so a face the client cannot load degrades to a
system font rather than to the browser default. Shipping a licensed corporate face is a fork +
rebuild; this is the one branding setting that is not purely runtime, and docs/02 §11 and
`config.example.yaml` say why.

Type scale (rem): 0.75 / 0.875 / 1 / 1.25 / 1.5 / 2 / 2.5. Service names at 1rem semibold;
category labels at 0.875rem; the "Datenverwaltung" sub-label at 0.875rem muted; the description
at 0.875rem with generous line-height.

The **red bar to the left of a heading** (seen on every PDF section title) is a cheap, on-brand
structural device — keep it as the page-title motif.

## 4. Layout & responsive

- **Phone (default):** single-column **List** view. Top bar collapses to logo + a menu and is a
  **single row** at every width; the theme/view toggles and the quick links move into the account
  menu. The Favorites/Services switch is **not** in the bar: it is the underline **tab row**
  directly above the list (issue #170) — the two labels with their item counts, flush with the
  content's left edge, on a hairline the active tab's 2px brand underline sits on, with the
  favorites sort control on the row's right (icon-only on a phone). It is *navigation*, not an
  ARIA tablist: switching changes the URL and pushes a history entry, so the controls are buttons
  carrying `aria-current`, never `role="tab"`. The row steps aside while the favorites arrange
  mode is open, which brings its own bar. **Search** is the one launcher control that *is* in
  the bar (issue #171): it is global — it searches every service regardless of the active tab —
  so it sits above both tabs rather than inside the content one of them fills. On a phone it is
  a fully-rounded "Suchen" pill whose tap lays a full-width field over the bar row (below 360px
  the label gives way to the magnifier alone, so the wordmark keeps its width); on a desktop the
  field is simply there, with a `⌘K`/`Ctrl K` hint in its trailing slot that the clear ✕ takes
  over while there is a query. `⌘K`/`Ctrl+K` and `/` focus it, and both stand down inside a text
  input and under any open `role="dialog"`. **Results stay a view, not a panel** — a query
  replaces the content area under "Suchergebnisse", grouped "FAVORITEN · n" then
  "ALLE DIENSTE · n" with the server's rank preserved inside each group. That is the **only
  section heading the launcher has**: the unfiltered views are named by the active tab, and on a
  desktop every facet — "In Wartung", "Beta", a category — by its own highlighted pill directly
  above the list, so selecting a category never moves the pills or the cards (issue #182). The
  restricted-category marker lives on that pill.
  The list row is **two lines, not three columns**: the icon chip, the service name and the row's
  controls (documentation, favourite) share the top line, and the description spans the row's
  full width underneath. One line of controls beside the text left the description barely 40% of
  a 360px row and hyphenated nearly every German word — a text column must not be what fixed-width
  controls leave over (CLAUDE.md, "Design for the standard phones").
- **Tablet:** two-column table view becomes available.
- **Desktop:** **Table** view — categories as columns of compact tiles (the PDF "Tabelle" layout),
  max content width with comfortable gutters.
- Touch targets ≥ 44px. The tile's two zones must each be an easily-tappable region with a clear
  divider so nobody mis-taps launch when they meant expand.

### Control sizing: phone floor, pointer density from `md:`

One convention across every shared primitive (`web-ui/src/components/ui/`), so no screen has to
restate it and no screen can forget it:

- **Phone is the default.** A control's base classes carry the 44px floor — `h-11` / `min-h-11`
  (plus `w-11` for a square, icon-only control) and the roomier padding that goes with it. Users
  reported the phone UI as cramped (issue #99); the answer is better defaults, **not** a
  user-facing size setting.
- **`md:` hands back to pointer density.** `md:` (768px, the app's single mobile/desktop
  breakpoint — `web-ui/src/lib/breakpoints.ts`) restores the compact box: `md:h-10` for a button,
  `md:h-9` for a select, `md:min-h-0` for a pill, the icon's own box for an icon button. Never
  `sm:` — that is a fourth breakpoint the layout does not otherwise use, and it leaves the
  640–767px band with desktop density under a phone layout.
- **A control too small to be its own target puts the floor on its label.** A checkbox box stays a
  box; the `<label>` around it is the 44px hit area (the `checkbox` and `choice-chip` primitives —
  the latter is a chip-shaped checkbox/radio, so the chip *is* the control rather than a button
  pretending to be one). The viewport suite measures exactly that shape — a padded click-target
  parent around one small control.
- **Row heights follow.** A list row is ≥ 56px on a phone (`min-h-14`, `List`/`ListItem`) and the
  service list row ~72px, so the controls inside it clear each other.

Both directions are tested: `e2e/admin-viewport.spec.ts` and `e2e/issue-99-mobile-sizing.spec.ts`
assert the phone floor across the matrix *and* upper bounds on the desktop densities, so a future
change cannot inflate the pointer layout either.

## 5. The signature component — the two-zone tile

States to implement (light + dark, every one):

| Axis | Values |
|------|--------|
| Density | collapsed, expanded |
| Interaction | default, hover, focus-visible, active/pressed |
| Kind | service (launch icon), documentation-only (book/file icon) |
| Favorited | star outline / star filled |

Behavior contract (matches concept §4.2):
- **Top zone** = launch. Hover lifts elevation slightly and tints the title in brand red (per the
  PDF "Hover" column). Click opens `service_url` (or `doc_url` for doc-only) in a new tab and fires
  the click event. Cursor: pointer.
- **Bottom zone** = "▼ More details" / "▲ Less details". Click expands/collapses the description +
  documentation link **in place**. Never navigates. Animate height with `prefers-reduced-motion`
  respected.
- **Star** = favorite toggle, top-right, independent hit area.
- Clear horizontal divider between the zones so the two affordances read as two things.

Build it as a single accessible React component: the launch zone is a link (`<a>`), the expander is
a `<button aria-expanded>`, the star is a `<button aria-pressed>`. Three controls, three roles — so
keyboard and screen-reader users get the same crisp split sighted users get.

## 6. Key flows to design (beyond the tile)
- **Top navigation bar** with persistent active-tab highlight (the PDF's emphasised requirement).
- **Search** — overlay/expanding input, results grouped by category, keyboard up/down + enter.
- **Add-to-list dialog** — list dropdown + "＋ New list" inline input + Cancel/Save (the Figma modal),
  built on shadcn `Dialog` + `Select`.
- **Announcement banner** — severity-colored, dismissible (except critical), stacks if several.
- **Admin form** — clean CRUD: service create/edit with live tile **preview**, icon picker
  (lucide), multi-category select, URL fields with validation, soft-delete confirm.
- **Empty/loading/error states** for catalog, search, favorites — written in the interface's voice,
  per the writing guidance (e.g. empty favorites: "Nothing pinned yet. Tap ☆ on a service to keep it here.").

## 7. Dark / light mode
System preference by default; explicit toggle in the top bar; choice persists via user prefs.
Implement with a `.dark` class on `<html>` driving the CSS-variable swaps in §2. Verify brand red
contrast in dark mode — `--uos-red-600` on `--bg-dark` needs a check; lighten to a `--uos-red-500`
for dark surfaces if it fails AA on text.

## 8. Accessibility floor (non-negotiable, every phase)
- WCAG 2.1 AA contrast for text and UI in both themes.
- Visible `focus-visible` rings on every interactive element.
- Full keyboard operability (tiles, search, dialogs, tabs).
- Correct ARIA: `aria-expanded` on the expander, `aria-pressed` on the star, `aria-current` on the
  active tab, labelled dialogs, live region for announcement banners.
- `prefers-reduced-motion` respected for all transitions.
- German as primary language → `lang="de"`, correct handling of long compound nouns (the layout must
  not break on "Netzlaufwerkverbindung").

## 9. Working with Claude Design (Phase 5)
Bring Claude Design in **after** the structure and states exist and tests pass — polish a real,
working tile and dashboard, not a blank canvas. Feed it: this token table, the tile state matrix
(§5), and a screenshot of the assembled dashboard. Ask for refinement of spacing, elevation,
hover/active micro-interactions, and the table-view density — one component at a time, tile first.
Keep the "spend boldness in one place" rule: polish should sharpen the calm, not add decoration.
