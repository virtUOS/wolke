// Runtime theming: the SPA fetches the active skin from GET /api/branding and
// applies its token sets as CSS variables, so a fork re-skins by editing
// branding.yaml — no rebuild (docs/02 §11; docs/03 §2).

import { getJSON } from './api'

export type ThemeTokens = Record<string, string>

export interface Branding {
  product_name: string
  org_name: string
  logo_light: string
  logo_dark: string
  favicon: string
  default_locale: string
  imprint_url: string
  privacy_url: string
  feedback_url: string
  bot_url: string
  help_url: string
  theme: {
    light: ThemeTokens
    dark: ThemeTokens
  }
}

export async function fetchBranding(signal?: AbortSignal): Promise<Branding> {
  return getJSON<Branding>('/api/branding', signal)
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
function tokensToCSS(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([name, value]) => `--${name.replace(/_/g, '-')}: ${value};`)
    .join(' ')
}

// applyBrandingTokens injects (or replaces) a <style> element defining the light
// tokens on :root and the dark tokens on .dark, then sets the document title and
// the PWA theme-color to the active brand primary.
export function applyBrandingTokens(b: Branding): void {
  const css = `:root { ${tokensToCSS(b.theme.light)} } .dark { ${tokensToCSS(b.theme.dark)} }`
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
