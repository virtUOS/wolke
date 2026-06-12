import { applyBrandingTokens, type Branding } from '@/lib/branding'

const branding: Branding = {
  product_name: 'IT Service',
  org_name: 'Test Universität',
  logo_light: '/branding/logo-light.svg',
  logo_dark: '/branding/logo-dark.svg',
  favicon: '/branding/favicon.svg',
  default_locale: 'de',
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
})
