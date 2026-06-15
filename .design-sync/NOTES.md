# design-sync notes — wolke

Repo-specific gotchas for future syncs. `wolke-web` is an **app**, not a packaged component
library, so this sync runs in the converter's **synth-entry mode** (no `dist/`, components built
from `src/`).

## Setup that must be re-done on a fresh clone / re-sync
- **Self-symlink the package into its own node_modules** so `PKG_DIR` resolves to `web-ui/`:
  `ln -sfn .. web-ui/node_modules/wolke-web`. Without it the converter looks for
  `node_modules/wolke-web/package.json` and crashes (`ENOENT`). The symlink is gitignored.
- **Compiled CSS is the `cssEntry`.** The components are styled with Tailwind utilities, not a
  shipped stylesheet, so we compile one (tokens + used utilities) into the package and point
  `cfg.cssEntry` at it (bounded to `PKG_DIR`, hence inside `web-ui/`):
  `cd web-ui && npx tailwindcss -i src/index.css -o wolke-ds.generated.css --content './src/components/**/*.{ts,tsx}' --minify`
  Regenerate this before every re-sync (it's gitignored).
- Scope is `cfg.srcDir = src/components/ui` (the 14 primitive files → 15 components incl. ListItem).
  **Tile is not synced yet** — it lives in `src/components/`, outside `ui/`; add it later by moving
  it into `ui/`, or via an explicit entry. Feature components (Dashboard, admin/*) are intentionally
  out of scope (app-coupled).

## Known render warns (benign — do not chase)
- `[RENDER_THIN] IconButton`, `[RENDER_THIN] Popover`: both are icon-only triggers, so the thin
  check finds "no text". The gear glyph renders fine (confirmed on the contact sheet). Benign.
- `[FONT_MISSING] Inter`: the app declares `font-family: Inter, system-ui, …` but ships no
  `@font-face` (it assumes Inter is available, else falls back to system-ui). Declared via
  `cfg.runtimeFontPrefixes: ["Inter"]`; previews render in the system fallback, same as the app.

## Synth-mode quality caveat
- Without a real `.d.ts` build, emitted `<Name>.d.ts` props degrade to `{ [key: string]: unknown }`.
  Components are fully importable and the previews show real usage, but the prop contracts the design
  agent sees are weak. To strengthen them, add a library build (tsup/vite-lib emitting `.d.ts`) and
  set `cfg.buildCmd`, or hand-write `cfg.dtsPropsFor.<Name>`.

## Re-sync risks (what can silently go stale)
- The compiled `wolke-ds.generated.css` is a build artifact — if tokens/utilities change in the app
  and you forget to regenerate it, the synced CSS lags. Always regenerate (step above) before sync.
- Preview content (`.design-sync/previews/*.tsx`) imports from `'wolke-web'`; if a component's API
  changes, its preview can drift — the render check + grades will catch a broken render, not a
  semantic drift.
- `cfg.overrides.Dialog` pins `cardMode:single` so the fixed-position modal renders inside its card.
  If Dialog's structure changes, re-check that card.
