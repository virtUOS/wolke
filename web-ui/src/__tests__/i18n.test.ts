import { resolveLocale, effectiveLocale } from '@/lib/i18n'

describe('resolveLocale', () => {
  it('picks the browser language when it is supported, over the configured default', () => {
    expect(resolveLocale('de', ['en-US', 'de'])).toBe('en')
    expect(resolveLocale('en', ['de-DE'])).toBe('de')
  })

  it('matches on the base subtag, ignoring region', () => {
    expect(resolveLocale('de', ['en-GB'])).toBe('en')
    expect(resolveLocale('en', ['de-AT'])).toBe('de')
  })

  it('honors browser preference order, skipping unsupported languages', () => {
    expect(resolveLocale('de', ['fr-FR', 'en-US', 'de'])).toBe('en')
  })

  it('falls back to the configured default when no preference is supported', () => {
    expect(resolveLocale('de', ['fr', 'es'])).toBe('de')
    expect(resolveLocale('en', ['fr', 'es'])).toBe('en')
    expect(resolveLocale('de', [])).toBe('de')
  })

  it('treats an unknown default as de', () => {
    expect(resolveLocale(undefined, ['fr'])).toBe('de')
    expect(resolveLocale('xx', ['fr'])).toBe('de')
  })
})

describe('effectiveLocale', () => {
  it('an explicit user preference wins over both browser and default', () => {
    expect(effectiveLocale('en', 'de')).toBe('en')
    expect(effectiveLocale('de', 'en')).toBe('de')
  })

  it("'auto' defers to the browser, then the configured default", () => {
    // navigator.languages is jsdom's default (en-US); 'auto' should follow it.
    expect(effectiveLocale('auto', 'de')).toBe(resolveLocale('de'))
    expect(effectiveLocale(undefined, 'de')).toBe(resolveLocale('de'))
  })
})
