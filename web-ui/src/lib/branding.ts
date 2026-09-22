// Runtime theming: the SPA fetches the active skin from GET /api/branding and
// applies its token sets as CSS variables, so a fork re-skins by editing
// branding.yaml — no rebuild (docs/02 §11; docs/03 §2).

import { getJSON, type Localized } from './api'

export type ThemeTokens = Record<string, string>

export interface Branding {
  product_name: string
  org_name: string
  logo_light: string
  logo_dark: string
  favicon: string
  // Decorative institution mark for the launcher background (issue #174).
  // Empty means off, and off means no element at all — see Watermark.tsx.
  watermark: string
  default_locale: string
  imprint_url: string
  privacy_url: string
  feedback_url: string
  // Renames the footer feedback link (issue #222). Localized, because it is a
  // UI label rather than a proper noun; empty or absent is a no-op, i.e. the
  // built-in localized string. Resolved with the shared localized() helper,
  // which falls back between LANGUAGES — a value with only `de` set renders
  // German to an English reader, which is what a deployment that translated
  // one language wants, and is not the same as falling back to the built-in
  // label. The link itself is gated by feedback_url, so a label without one
  // shows nothing.
  feedback_label: Localized
  bot_url: string
  help_url: string
  // The institution's news site, linked at the foot of the notification panel.
  // Empty hides the link; the server accepts only http(s) here.
  news_url: string
  // Embedded assistant chat widget (launcher mode); active only when both are
  // set, in which case it supersedes the bot_url top-bar link.
  assistant_widget_url: string
  assistant_bot_id: string
  theme: {
    light: ThemeTokens
    dark: ThemeTokens
  }
  // Typography roles (issue #214), keyed `body` / `display` — each a complete
  // CSS font stack, applied to :root. Deliberately outside `theme`: a face is
  // not per-theme. A skin SELECTS one of the bundled faces or a system stack;
  // it cannot ship a font file, which is the one branding setting that needs a
  // rebuild (docs/02 §11).
  fonts: ThemeTokens
  // Whether the launcher greeting's trailing full stop is set in `primary`
  // (issue #220). Unlike the other recent settings this one is ON by default:
  // the accent uses the deployment's own brand colour, so there is nothing to
  // opt into — only out of.
  greeting_accent: boolean
}

export async function fetchBranding(signal?: AbortSignal): Promise<Branding> {
  return getJSON<Branding>('/api/branding', signal)
}

// assistantEnabled reports whether the embedded assistant widget is configured
// (both fields required). When true it supersedes the bot_url top-bar link.
export function assistantEnabled(b: Branding): boolean {
  return Boolean(b.assistant_widget_url && b.assistant_bot_id)
}

// contactHref resolves a help_url value to a link target. An http(s) URL opens
// in a new tab; a phone number (or an explicit tel: value) becomes a tel: link,
// which opens the dialer on a smartphone. Returns null for an empty value.
export function contactHref(value: string): { href: string; external: boolean } | null {
  const v = value.trim()
  if (!v) return null
  if (/^tel:/i.test(v)) return { href: v, external: false }
  if (/^https?:\/\//i.test(v)) return { href: v, external: true }
  if (/^\+?\d[\d\s()/.-]*$/.test(v)) return { href: `tel:${v.replace(/[\s()/.-]/g, '')}`, external: false }
  return { href: v, external: true }
}

// feedbackHref resolves a feedback_url value to a link target. An http(s) URL
// opens in a new tab; an email (or explicit mailto:) becomes a mailto: link.
// Returns null for an empty value.
export function feedbackHref(value: string): { href: string; external: boolean } | null {
  const v = value.trim()
  if (!v) return null
  if (/^mailto:/i.test(v)) return { href: v, external: false }
  if (/^https?:\/\//i.test(v)) return { href: v, external: true }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { href: `mailto:${v}`, external: false }
  return { href: v, external: true }
}

// tokensToCSS turns {primary_hover: "#8A0732"} into "--primary-hover: #8A0732;",
// keeping the underscore→hyphen mapping that Tailwind's var() names expect.
// `prefix` names the variable family: the font roles arrive keyed `body` and
// `display` and become --font-body / --font-display.
function tokensToCSS(tokens: ThemeTokens | undefined, prefix = ''): string {
  return Object.entries(tokens ?? {})
    .map(([name, value]) => `--${prefix}${name.replace(/_/g, '-')}: ${value};`)
    .join(' ')
}

// applyBrandingTokens injects (or replaces) a <style> element defining the light
// tokens on :root and the dark tokens on .dark, then sets the document title and
// the PWA theme-color to the active brand primary.
export function applyBrandingTokens(b: Branding): void {
  // The font roles join the :root half and have no .dark counterpart: a skin
  // re-colours across the two themes, it does not re-face (issue #214).
  const root = `${tokensToCSS(b.theme.light)} ${tokensToCSS(b.fonts, 'font-')}`.trim()
  const css = `:root { ${root} } .dark { ${tokensToCSS(b.theme.dark)} }`
  let el = document.getElementById('branding-tokens')
  if (!el) {
    el = document.createElement('style')
    el.id = 'branding-tokens'
    document.head.appendChild(el)
  }
  el.textContent = css
  document.title = b.product_name
  // Keep the PWA/browser-UI theme-color white-label: track the brand primary.
  const themeColor = b.theme.light?.primary
  if (themeColor) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor)
  }
}

// applySystemTheme picks light/dark from the OS preference for first paint. An
// explicit, persisted user toggle lands in Phase 1.
export function applySystemTheme(): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', Boolean(prefersDark))
}
