import { applyFilter, filterEq, matchesQuery, searchAll, type Filter } from '@/lib/catalog-filter'
import type { Service } from '@/lib/api'

function svc(over: Partial<Service>): Service {
  return {
    id: 'x', name: 'X', description: { de: '' }, icon: 'box', categories: [], doc_only: false, ...over,
  }
}

const studip = svc({ id: '1', name: 'Stud.IP', description: { de: 'Lernplattform', en: 'Learning platform' }, categories: ['teaching'] })
const vpn = svc({ id: '2', name: 'VPN', description: { de: 'Netzzugang', en: 'Network access' }, categories: ['data'], tag: 'wartung' })
const mail = svc({ id: '3', name: 'Webmail', description: { de: 'E-Mail' }, categories: ['communication'] })
const all = [studip, vpn, mail]

describe('matchesQuery', () => {
  it('matches the name case-insensitively', () => {
    expect(matchesQuery(studip, 'stud')).toBe(true)
    expect(matchesQuery(studip, 'VPN')).toBe(false)
  })
  it('matches any localized description', () => {
    expect(matchesQuery(studip, 'learning')).toBe(true)
    expect(matchesQuery(studip, 'lernplattform')).toBe(true)
  })
  it('an empty/blank query matches everything', () => {
    expect(matchesQuery(vpn, '')).toBe(true)
    expect(matchesQuery(vpn, '   ')).toBe(true)
  })
})

describe('searchAll', () => {
  it('searches across all services, ignoring categories and tags', () => {
    expect(searchAll(all, 'access').map((s) => s.id)).toEqual(['2'])
    expect(searchAll(all, 'e').map((s) => s.id).sort()).toEqual(['1', '2', '3']) // name/desc matches
  })
  it('returns the full list for a blank query', () => {
    expect(searchAll(all, '')).toEqual(all)
  })
})

describe('applyFilter', () => {
  it('all returns everything', () => {
    expect(applyFilter(all, { kind: 'all' })).toEqual(all)
  })
  it('category narrows to members of that slug', () => {
    expect(applyFilter(all, { kind: 'category', slug: 'teaching' }).map((s) => s.id)).toEqual(['1'])
  })
  it('maintenance narrows to services tagged wartung', () => {
    expect(applyFilter(all, { kind: 'maintenance' }).map((s) => s.id)).toEqual(['2'])
  })
})

describe('filterEq', () => {
  it('compares kind, and slug for categories', () => {
    const a: Filter = { kind: 'category', slug: 'teaching' }
    expect(filterEq(a, { kind: 'category', slug: 'teaching' })).toBe(true)
    expect(filterEq(a, { kind: 'category', slug: 'data' })).toBe(false)
    expect(filterEq({ kind: 'all' }, { kind: 'all' })).toBe(true)
    expect(filterEq({ kind: 'all' }, { kind: 'maintenance' })).toBe(false)
  })
})
