# UI primitives

The reusable, **presentational** building blocks the rest of the app composes (and that we sync to
Claude Design). They are the leaves of the component tree — the styled vocabulary, not the wiring.

This convention exists so the set stays coherent as it grows and so every primitive ports cleanly to
Claude Design later. An enforcement test (`src/__tests__/ui-primitives.test.ts`) keeps the hard rules
honest.

The set: `button`, `icon-button`, `pill-button`, `card`, `badge`, `input`, `label`, `field`,
`select`, `alert`, `list` (List/ListItem), `dialog`, `popover`. The interactive overlays
(`dialog`, `popover`) are hand-rolled but implement the Radix behaviour set (focus trap/return,
Escape + outside-click dismiss, ARIA) behind Radix-shaped APIs, so Radix can be swapped in later
without touching callers. `select` is a styled native `<select>` and `list` is a styled `<ul>`
(not a `<table>`) — reach for richer primitives (Radix Select, a real Table) only when the data
actually needs them.

## Rules

1. **Pure presentation — no data.** A primitive takes everything via props. It must not fetch or
   own server state: no `@tanstack/react-query` (`useQuery`/`useMutation`/`useQueryClient`), no
   `fetch`, no API calls. Importing **types** from `@/lib/api` is fine; importing its functions is
   not. Data lives in containers — `Dashboard.tsx` is the single fetch root (everything else is
   already props-driven; keep it that way).

2. **The `cva` + `cn` pattern.** Variants are declared with `class-variance-authority` and merged
   with `cn` from `@/lib/utils` (see `button.tsx` as the reference). Expose `VariantProps` on the
   public props type. Forward refs and spread `...props` so the primitive stays a drop-in for the
   native element it wraps.

3. **Tokens, never raw values.** Style with the Tailwind token utilities backed by the CSS
   variables (`bg-primary`, `text-text-muted`, `border-border`, `bg-surface-2`, `text-danger`, …;
   see docs/03 §2). No hardcoded hex — a primitive must re-skin from `/api/branding` with no rebuild.
   Brand red (`primary`) is for brand + interaction only; use the feedback tokens
   (`info`/`warning`/`success`/`danger`) for state.

4. **Accessible by construction** (CLAUDE.md #7, docs/03 §8). Keyboard-operable, a visible
   `focus-visible` ring, correct ARIA/roles. This is not a Phase-5 afterthought — it ships with the
   primitive. New primitives get an axe + keyboard check.

5. **Localised strings stay out.** Primitives render the labels they're given; `{de,en}` selection
   happens in the calling feature component, not here.

## Adding one (Phase C cadence)

Spec (docs/03) → failing test → implement → axe + keyboard check → migrate one real consumer off its
hand-rolled markup onto the new primitive. One primitive per commit.
