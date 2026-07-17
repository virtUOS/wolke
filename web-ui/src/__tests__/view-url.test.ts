import { DEFAULT_VIEW, parseViewURL, viewEq, viewToURL, type View } from '@/lib/view-url'

const dienste: View = { tab: 'dienste', filter: { kind: 'all' }, admin: false }
const lehre: View = { tab: 'dienste', filter: { kind: 'category', slug: 'lehre' }, admin: false }
const wartung: View = { tab: 'dienste', filter: { kind: 'maintenance' }, admin: false }
const admin: View = { ...DEFAULT_VIEW, admin: true }

describe('viewToURL', () => {
  it('serializes the default view to plain /', () => {
    expect(viewToURL(DEFAULT_VIEW)).toBe('/')
  })

  it('serializes each facet', () => {
    expect(viewToURL(dienste)).toBe('/?tab=dienste')
    expect(viewToURL(lehre)).toBe('/?cat=lehre')
    expect(viewToURL(wartung)).toBe('/?filter=wartung')
    expect(viewToURL(admin)).toBe('/?admin=1')
  })

  it('combines admin with tab/filter and omits tab when a filter implies it', () => {
    expect(viewToURL({ ...lehre, admin: true })).toBe('/?cat=lehre&admin=1')
    expect(viewToURL({ ...dienste, admin: true })).toBe('/?tab=dienste&admin=1')
  })
})

describe('parseViewURL', () => {
  it('round-trips every view shape', () => {
    for (const v of [DEFAULT_VIEW, dienste, lehre, wartung, admin, { ...wartung, admin: true }]) {
      const url = new URL(viewToURL(v), 'http://x')
      expect(parseViewURL(url.search)).toEqual(v)
    }
  })

  it('is lenient: empty, unknown params, bogus values fall back to defaults', () => {
    expect(parseViewURL('')).toEqual(DEFAULT_VIEW)
    expect(parseViewURL('?utm_source=mail&tab=bogus&admin=yes')).toEqual(DEFAULT_VIEW)
  })

  it('lets filter params win: cat implies dienste and beats filter and tab', () => {
    expect(parseViewURL('?tab=favoriten&cat=lehre')).toEqual(lehre)
    expect(parseViewURL('?cat=lehre&filter=wartung')).toEqual(lehre)
    expect(parseViewURL('?filter=wartung')).toEqual(wartung)
  })
})

describe('viewEq', () => {
  it('compares tab, admin, and filter including category slugs', () => {
    expect(viewEq(DEFAULT_VIEW, { ...DEFAULT_VIEW })).toBe(true)
    expect(viewEq(DEFAULT_VIEW, dienste)).toBe(false)
    expect(viewEq(DEFAULT_VIEW, admin)).toBe(false)
    expect(viewEq(lehre, { ...lehre, filter: { kind: 'category', slug: 'x' } })).toBe(false)
  })
})
