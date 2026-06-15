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
| `--accent`         | `#F2C879` | `#F2C879` | sparing accent (info callout) |
| `--surface`        | `#F4F4F5` | `#1E1E21` | page background behind cards |
| `--surface-2`      | `#ECECEE` | `#27272B` | tile footer / inset zones |
| `--border`         | `#E2E2E5` | `#34343A` | hairlines, dividers, card edges |
| `--text`           | `#18181B` | `#F4F4F5` | body text |
| `--text-muted`     | `#6B6B70` | `#9A9AA1` | sub-labels, secondary text |
| `--info`           | `#2563EB` | `#60A5FA` | informational state / banner |
| `--warning`        | `#B45309` | `#FBBF24` | warning state / banner |
| `--success`        | `#15803D` | `#4ADE80` | success state / confirmations |
| `--danger`         | `#B91C1C` | `#F87171` | destructive actions, critical state |

Announcement severities map onto these: `info`→`--info`, `warning`→`--warning`, `critical`→`--danger`.
Brand red (`--primary`) is for **brand + interaction only** — never large fills, or it stops meaning
"actionable"; `--danger` is the distinct true-red for destructive/critical, so the two don't blur.

**Structural tokens** — *not* brand-overridable; defined statically in `index.css` and identical across
skins (a deployer re-colours, but doesn't restructure). They flip on `.dark` where it matters.

```css
--bg:        #FFFFFF;  /* .dark: #161618 — app canvas; deliberately not in the branding payload */
--radius-sm: 0.25rem;  --radius-md: 0.375rem;  --radius-lg: 0.5rem;   /* corner scale */
```

Type scale (rem, structural, mapped to Tailwind `fontSize`): `0.75 / 0.875 / 1 / 1.25 / 1.5 / 2 / 2.5`.
Spacing and elevation use Tailwind's default scales — no custom tokens (keep it boring).

## 3. Typography

A university tool should feel institutional but current — confirm whether UOS mandates a corporate
typeface (many universities license one). If not:

- **Display / headings:** a confident grotesque — e.g. **Inter Tight** or the UOS corporate face if
  mandated. Used at the page title scale ("Navigation", "Kachel" style in the PDF — heavy weight,
  with the small red bar accent to its left).
- **Body / UI:** **Inter** — neutral, excellent at small sizes, great German diacritics and ß.
- **Mono (data only):** **JetBrains Mono**, for any IDs/metrics in the admin view.

Type scale (rem): 0.75 / 0.875 / 1 / 1.25 / 1.5 / 2 / 2.5. Service names at 1rem semibold;
category labels at 0.875rem; the "Datenverwaltung" sub-label at 0.875rem muted; the description
at 0.875rem with generous line-height.

The **red bar to the left of a heading** (seen on every PDF section title) is a cheap, on-brand
structural device — keep it as the page-title motif.

## 4. Layout & responsive

- **Phone (default):** single-column **List** view. Top bar collapses to logo + search + a menu;
  Services/Favorites as a segmented control; the theme/view toggles move into an overflow menu.
- **Tablet:** two-column table view becomes available.
- **Desktop:** **Table** view — categories as columns of compact tiles (the PDF "Tabelle" layout),
  max content width with comfortable gutters.
- Touch targets ≥ 44px. The tile's two zones must each be an easily-tappable region with a clear
  divider so nobody mis-taps launch when they meant expand.

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
