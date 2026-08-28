// Unit coverage for the aria-snapshot line grammar (the pure half of
// helpers/a11y.ts). Two defects this guards against, both silent:
//   • headings are written `- heading "…" [level=N]`, with no colon after the
//     role, so a colon-anchored pattern exempted every heading from the check;
//   • a value containing a colon is YAML-quoted, and comparing it with its
//     quotes still attached reports a false orphan.

import { describe, expect, it } from 'vitest'
import { announcedTextFromSnapshot, unquoteScalar } from './a11y'

describe('announcedTextFromSnapshot', () => {
  it('reads a keyed value', () => {
    expect(announcedTextFromSnapshot('- text: 4 Dienste')).toEqual(['4 Dienste'])
  })

  it('reads a paragraph', () => {
    expect(announcedTextFromSnapshot('  - paragraph: Passwort ändern und Konto verwalten.')).toEqual([
      'Passwort ändern und Konto verwalten.',
    ])
  })

  it('reads a heading, which carries its text as a quoted name', () => {
    expect(announcedTextFromSnapshot('  - heading "Guten Tag, Test." [level=1]')).toEqual(['Guten Tag, Test.'])
  })

  it('reads a heading that has children (trailing colon)', () => {
    expect(announcedTextFromSnapshot('- heading "Mitteilungen" [level=2]:')).toEqual(['Mitteilungen'])
  })

  it('strips the quotes from a value that needed them', () => {
    expect(announcedTextFromSnapshot('- text: "Wartung: 12:30 bis 14:00"')).toEqual(['Wartung: 12:30 bis 14:00'])
  })

  it('strips the quotes from a quoted heading name with a colon', () => {
    expect(announcedTextFromSnapshot('- heading "Hinweis: Wartung" [level=2]')).toEqual(['Hinweis: Wartung'])
  })

  it('ignores control names — a label may differ from the visible text', () => {
    const snapshot = [
      '- link "Zum Inhalt springen":',
      '  - /url: "#main"',
      '- button "Konto-Menü öffnen": TS',
      '- searchbox "Dienste suchen"',
    ].join('\n')
    expect(announcedTextFromSnapshot(snapshot)).toEqual([])
  })

  it('ignores a role whose name merely starts like a content role', () => {
    expect(announcedTextFromSnapshot('- textbox "Suche"')).toEqual([])
    expect(announcedTextFromSnapshot('- headingsomething: x')).toEqual([])
  })

  it('skips a node that only opens a subtree', () => {
    expect(announcedTextFromSnapshot('- listitem:')).toEqual([])
  })

  it('skips a block scalar header rather than announcing a literal pipe', () => {
    expect(announcedTextFromSnapshot('- text: |\n    zwei\n    Zeilen')).toEqual([])
    expect(announcedTextFromSnapshot('- text: >-')).toEqual([])
  })

  it('normalizes whitespace', () => {
    expect(announcedTextFromSnapshot('- text:   viel    Platz  ')).toEqual(['viel Platz'])
  })

  it('walks a whole snapshot in document order', () => {
    const snapshot = [
      '- banner:',
      '  - text: wolke',
      '  - navigation "Hauptnavigation":',
      '    - button "Favoriten"',
      '- main:',
      '  - heading "Guten Tag, Test." [level=1]',
      '  - searchbox "Dienste suchen"',
      '  - text: 4 Dienste',
      '  - paragraph: Persönlicher Netzspeicher der Universität.',
    ].join('\n')
    expect(announcedTextFromSnapshot(snapshot)).toEqual([
      'wolke',
      'Guten Tag, Test.',
      '4 Dienste',
      'Persönlicher Netzspeicher der Universität.',
    ])
  })
})

describe('unquoteScalar', () => {
  it('leaves a bare scalar alone', () => {
    expect(unquoteScalar('4 Dienste')).toBe('4 Dienste')
  })

  it('unwraps a double-quoted scalar and its escapes', () => {
    expect(unquoteScalar('"a: b"')).toBe('a: b')
    expect(unquoteScalar('"sagt \\"hallo\\""')).toBe('sagt "hallo"')
    expect(unquoteScalar('"C:\\\\Users"')).toBe('C:\\Users')
  })

  it('unwraps a single-quoted scalar and its doubled quote', () => {
    expect(unquoteScalar("'a: b'")).toBe('a: b')
    expect(unquoteScalar("'it''s'")).toBe("it's")
  })

  it('does not strip a lone quote character', () => {
    expect(unquoteScalar('"')).toBe('"')
  })
})
