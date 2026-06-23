import { applyBrandingTokens, type Branding } from '@/lib/branding'

const branding: Branding = {
  product_name: 'IT Service',
  org_name: 'Test Universität',
  logo_light: '/branding/logo-light.svg',
  logo_dark: '/branding/logo-dark.svg',
  favicon: '/branding/favicon.svg',
  default_locale: 'de',
  imprint_url: 'https://example.edu/impressum',
  privacy_url: 'https://example.edu/datenschutz',
  theme: {
    light: { primary: '#A6093D', primary_hover: '#8A0732' },
    dark: { primary: '#C2355C' },
  },
}

describe('applyBrandingTokens', () => {
  it('injects light and dark CSS variables and sets the title', () => {
    applyBrandingTokens(branding)
    const el = document.getElementById('branding-tokens')
    expect(el).not.toBeNull()
    expect(el?.textContent).toContain('--primary: #A6093D')
    expect(el?.textContent).toContain('--primary-hover: #8A0732')
    expect(el?.textContent).toContain('.dark')
    expect(document.title).toBe('IT Service')
  })

  it('maps multi-segment underscore token names to hyphenated CSS vars', () => {
    applyBrandingTokens({
      ...branding,
      theme: { light: { surface_2: '#ECECEE', text_muted: '#6B6B70' }, dark: {} },
    })
    const css = document.getElementById('branding-tokens')?.textContent
    expect(css).toContain('--surface-2: #ECECEE')
    expect(css).toContain('--text-muted: #6B6B70')
  })
})
