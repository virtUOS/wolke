// Runtime theming: the SPA fetches the active skin from GET /api/branding and
// applies its token sets as CSS variables, so a fork re-skins by editing
// branding.yaml — no rebuild (docs/02 §11; docs/03 §2).

export type ThemeTokens = Record<string, string>

export interface Branding {
  product_name: string
  org_name: string
  logo_light: string
  logo_dark: string
  favicon: string
  default_locale: string
  theme: {
    light: ThemeTokens
    dark: ThemeTokens
  }
}

export async function fetchBranding(signal?: AbortSignal): Promise<Branding> {
  const res = await fetch('/api/branding', { signal })
  if (!res.ok) {
    throw new Error(`GET /api/branding failed: ${res.status}`)
  }
  return (await res.json()) as Branding
}

// tokensToCSS turns {primary_hover: "#8A0732"} into "--primary-hover: #8A0732;",
// keeping the underscore→hyphen mapping that Tailwind's var() names expect.
function tokensToCSS(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([name, value]) => `--${name.replace(/_/g, '-')}: ${value};`)
    .join(' ')
}

// applyBrandingTokens injects (or replaces) a <style> element defining the light
// tokens on :root and the dark tokens on .dark, then sets the document title.
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
}

// applySystemTheme picks light/dark from the OS preference for first paint. An
// explicit, persisted user toggle lands in Phase 1.
export function applySystemTheme(): void {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', Boolean(prefersDark))
}
