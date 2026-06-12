import { render, screen } from '@testing-library/react'
import { AppShell } from '@/components/AppShell'
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

describe('AppShell', () => {
  it('renders the product name as a heading', () => {
    render(<AppShell branding={branding} />)
    expect(screen.getByRole('heading', { name: 'IT Service' })).toBeInTheDocument()
  })

  it('renders a main landmark and a labelled nav', () => {
    render(<AppShell branding={branding} />)
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Hauptnavigation' })).toBeInTheDocument()
  })

  it('shows the logo with the product name as alt text', () => {
    render(<AppShell branding={branding} />)
    expect(screen.getByAltText('IT Service')).toBeInTheDocument()
  })
})

describe('applyBrandingTokens', () => {
  it('injects light and dark CSS variables from the payload', () => {
    applyBrandingTokens(branding)
    const el = document.getElementById('branding-tokens')
    expect(el).not.toBeNull()
    expect(el?.textContent).toContain('--primary: #A6093D')
    expect(el?.textContent).toContain('--primary-hover: #8A0732')
    expect(el?.textContent).toContain('.dark')
    expect(document.title).toBe('IT Service')
  })
})
