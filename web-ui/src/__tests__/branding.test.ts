import { applyBrandingTokens, assistantEnabled, contactHref, feedbackHref, type Branding } from '@/lib/branding'

const branding: Branding = {
  product_name: 'IT Service',
  org_name: 'Test Universität',
  logo_light: '/branding/logo-light.svg',
  logo_dark: '/branding/logo-dark.svg',
  favicon: '/branding/favicon.svg',
  default_locale: 'de',
  imprint_url: 'https://example.edu/impressum',
  privacy_url: 'https://example.edu/datenschutz',
  feedback_url: '',
  bot_url: '',
  help_url: '',
  assistant_widget_url: '',
  assistant_bot_id: '',
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

describe('assistantEnabled', () => {
  it('requires both the widget URL and the bot id', () => {
    expect(assistantEnabled(branding)).toBe(false)
    expect(assistantEnabled({ ...branding, assistant_widget_url: 'https://a.example.edu/widget.js' })).toBe(false)
    expect(assistantEnabled({ ...branding, assistant_bot_id: 'echo' })).toBe(false)
    expect(
      assistantEnabled({
        ...branding,
        assistant_widget_url: 'https://a.example.edu/widget.js',
        assistant_bot_id: 'echo',
      }),
    ).toBe(true)
  })
})

describe('contactHref', () => {
  it('returns null for an empty/blank value', () => {
    expect(contactHref('')).toBeNull()
    expect(contactHref('   ')).toBeNull()
  })

  it('opens an http(s) URL in a new tab', () => {
    expect(contactHref('https://help.example.edu')).toEqual({ href: 'https://help.example.edu', external: true })
  })

  it('turns a phone number into a tel: link (dialer), stripped of separators', () => {
    expect(contactHref('+49 (541) 969-0')).toEqual({ href: 'tel:+495419690', external: false })
    expect(contactHref('0541 9690')).toEqual({ href: 'tel:05419690', external: false })
  })

  it('passes an explicit tel: value through without a new tab', () => {
    expect(contactHref('tel:+49123')).toEqual({ href: 'tel:+49123', external: false })
  })
})

describe('feedbackHref', () => {
  it('returns null for an empty/blank value', () => {
    expect(feedbackHref('')).toBeNull()
    expect(feedbackHref('   ')).toBeNull()
  })

  it('opens an http(s) URL in a new tab', () => {
    expect(feedbackHref('https://feedback.example.edu')).toEqual({ href: 'https://feedback.example.edu', external: true })
  })

  it('turns an email into a mailto: link (no new tab)', () => {
    expect(feedbackHref('feedback@example.edu')).toEqual({ href: 'mailto:feedback@example.edu', external: false })
  })

  it('passes an explicit mailto: value through', () => {
    expect(feedbackHref('mailto:feedback@example.edu?subject=Hi')).toEqual({
      href: 'mailto:feedback@example.edu?subject=Hi',
      external: false,
    })
  })
})
