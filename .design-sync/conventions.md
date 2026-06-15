# wolke — building with this design system

wolke is a role-aware university IT-service launcher. These are its real, shipped React
primitives. Build screens by composing them; reach for a raw `<div>` only for layout.

## Theme & setup
No provider is required — every component is presentational and takes its data via props. Theming
is via **CSS variables**: a `.dark` class on a root ancestor (e.g. `<html class="dark">`) swaps the
token values; everything else re-skins automatically. Never hardcode hex — always use the token
utilities below so a design re-skins from `/api/branding` without edits.

## Styling idiom — Tailwind utilities backed by tokens
Style with these utility classes (they map to the CSS variables in `styles.css`). This is the only
color vocabulary; do not invent hex values.

| Concern | Classes |
|---|---|
| Surfaces | `bg-bg` (app canvas), `bg-surface`, `bg-surface-2` (inset/footer) |
| Text | `text-text`, `text-text-muted` |
| Brand (interaction only) | `bg-primary`, `hover:bg-primary-hover`, `text-primary` — **brand red is for primary actions, active state, and brand only; never large fills** |
| Borders / dividers | `border border-border`, `divide-y divide-border` |
| Feedback (state) | `text-info` / `text-warning` / `text-success` / `text-danger` (and the matching `bg-*`); use these for status, not brand red |
| Radius | `rounded-sm` / `rounded-md` / `rounded-lg` |
| Focus (a11y floor) | `focus-visible:ring-2 focus-visible:ring-[var(--primary)]` — every interactive element ships a visible focus ring |

## Components (window.Wolke / re-exported)
Buttons & actions: `Button` (variant `default`/`outline`/`ghost`, size `default`/`sm`/`icon`),
`IconButton` (icon-only — `aria-label` required), `PillButton` (tab/segment, `active` prop).
Forms: `Field` (label + control + error/hint wiring), `Label`, `Input`, `Textarea`, `Select`
(native). Surfaces & data: `Card` (`padding`, `elevation`, `interactive`), `Badge`
(`neutral`/`info`/`warning`/`success`/`danger`), `List` + `ListItem`, `Alert` (severity message,
optional `onDismiss`). Overlays: `Dialog` (controlled `open`/`onOpenChange`, focus-trapped),
`Popover` (icon-triggered floating panel).

## Where the truth lives
Read `styles.css` (and its `@import` closure) for the token values, and each component's
`<Name>.d.ts` / `<Name>.prompt.md` for its API before composing.

## Idiomatic snippet
```tsx
<Card padding="md" elevation="sm" className="max-w-sm">
  <Field label="Dienstname">
    <Input placeholder="Rechenzentrum" />
  </Field>
  <div className="mt-4 flex justify-end gap-2">
    <Button variant="outline">Abbrechen</Button>
    <Button>Speichern</Button>
  </div>
</Card>
```
