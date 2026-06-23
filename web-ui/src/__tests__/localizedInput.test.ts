import { localizedInput } from '@/lib/api'

describe('localizedInput', () => {
  it('always sets a trimmed de value', () => {
    expect(localizedInput(undefined, '  Hallo  ', '')).toEqual({ de: 'Hallo' })
  })

  it('adds en only when the field is non-empty (trimmed)', () => {
    expect(localizedInput(undefined, 'Hallo', '  Hello ')).toEqual({ de: 'Hallo', en: 'Hello' })
    expect(localizedInput(undefined, 'Hallo', '   ')).toEqual({ de: 'Hallo' })
  })

  it('clears a previously set en when the field is emptied', () => {
    expect(localizedInput({ de: 'Alt', en: 'Old' }, 'Neu', '')).toEqual({ de: 'Neu' })
  })

  it('preserves other locales already present', () => {
    expect(localizedInput({ de: 'A', fr: 'B' }, 'A', 'C')).toEqual({ de: 'A', en: 'C', fr: 'B' })
  })
})
