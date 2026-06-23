import { icons, type LucideIcon } from 'lucide-react'

// The full lucide icon set as a SINGLE lazy chunk: importing `icons` pulls every
// glyph into one module. Loaded on demand only by the admin icon picker and by
// ServiceIcon's fallback (for a catalog icon outside the curated set), so it is
// ONE request — never one-per-glyph — and most users never load it at all.

const map = icons as Record<string, LucideIcon>

// lucide's `icons` map is keyed PascalCase; services store kebab-case. This is
// lucide's own PascalCase→kebab conversion, so derived names match the canonical
// icon names (e.g. AArrowDown → a-arrow-down).
function toKebab(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

const byKebab: Record<string, LucideIcon> = {}
for (const pascal in map) byKebab[toKebab(pascal)] = map[pascal]

export const allIconNames: string[] = Object.keys(byKebab).sort()

// iconComponent resolves a kebab name to its lucide component (synchronous — the
// whole set is already in this chunk, so no extra request per icon).
export function iconComponent(name: string): LucideIcon | undefined {
  return byKebab[name]
}
