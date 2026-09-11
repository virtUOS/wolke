// Parser coverage for the announcement link syntax (issue #168).
//
// The grammar is deliberately tiny: bare URLs on an allowlisted scheme, plus
// `[label](url)`. Everything else — including a labelled link whose target is
// not allowlisted — stays literal text. React does not reliably block a
// `javascript:` href, so the scheme allowlist here *is* the defence; the cases
// below are the security contract, not style preferences.

import { describe, expect, it } from 'vitest'
import { parseLinks, plainText, type Segment } from '@/lib/rich-text'

/** The href of every link segment, in order. */
const hrefs = (text: string): string[] =>
  parseLinks(text).flatMap((s) => (s.kind === 'link' ? [s.href] : []))

/** The rendered text of every segment joined back together — what the eye sees. */
const rendered = (text: string): string =>
  parseLinks(text)
    .map((s) => (s.kind === 'text' ? s.text : s.label))
    .join('')

const link = (href: string, label = href): Segment => ({ kind: 'link', href, label })
const text = (t: string): Segment => ({ kind: 'text', text: t })

describe('parseLinks — bare URLs', () => {
  it('autolinks an https URL mid-sentence', () => {
    expect(parseLinks('Siehe https://status.example.edu für Details.')).toEqual([
      text('Siehe '),
      link('https://status.example.edu'),
      text(' für Details.'),
    ])
  })

  it('excludes a trailing period from the href', () => {
    expect(parseLinks('Mehr unter https://status.example.edu.')).toEqual([
      text('Mehr unter '),
      link('https://status.example.edu'),
      text('.'),
    ])
  })

  it('excludes trailing commas and other sentence punctuation', () => {
    expect(hrefs('https://a.example/x, https://b.example/y; https://c.example/z!')).toEqual([
      'https://a.example/x',
      'https://b.example/y',
      'https://c.example/z',
    ])
  })

  it('excludes a closing parenthesis that only wraps the URL', () => {
    expect(parseLinks('(siehe https://status.example.edu/plan)')).toEqual([
      text('(siehe '),
      link('https://status.example.edu/plan'),
      text(')'),
    ])
  })

  it('keeps a balanced closing parenthesis that belongs to the URL', () => {
    const url = 'https://de.wikipedia.org/wiki/Kater_(Tier)'
    expect(hrefs(`Siehe ${url} dazu.`)).toEqual([url])
  })

  it('keeps a balanced parenthesis even when the URL is itself wrapped', () => {
    const url = 'https://de.wikipedia.org/wiki/Kater_(Tier)'
    expect(parseLinks(`(${url})`)).toEqual([text('('), link(url), text(')')])
  })

  it('autolinks http, mailto and tel', () => {
    expect(hrefs('http://intern.example.edu')).toEqual(['http://intern.example.edu'])
    expect(hrefs('Schreiben an mailto:support@example.edu bitte')).toEqual(['mailto:support@example.edu'])
    expect(hrefs('Telefon tel:+4954196912345 erreichbar')).toEqual(['tel:+4954196912345'])
  })

  it('does not autolink a scheme that is part of a longer word', () => {
    expect(hrefs('Hotel: 1234')).toEqual([])
    expect(hrefs('Kartell:12')).toEqual([])
    expect(hrefs('xhttps://evil.example')).toEqual([])
  })

  it('does not autolink a bare scheme with no target', () => {
    expect(parseLinks('https:// und mailto: und tel:')).toEqual([text('https:// und mailto: und tel:')])
  })

  it('matches case-insensitively but keeps the URL as typed', () => {
    expect(hrefs('HTTPS://Status.Example.edu/Plan')).toEqual(['HTTPS://Status.Example.edu/Plan'])
  })

  it('links a 120-character URL as one segment', () => {
    const long = `https://status.example.edu/${'a'.repeat(93)}`
    expect(long).toHaveLength(120)
    expect(parseLinks(long)).toEqual([link(long)])
  })
})

describe('parseLinks — labelled links', () => {
  it('renders [label](url) as a link carrying only the label', () => {
    expect(parseLinks('Zur [Statusseite](https://status.example.edu) wechseln')).toEqual([
      text('Zur '),
      { kind: 'link', href: 'https://status.example.edu', label: 'Statusseite' },
      text(' wechseln'),
    ])
  })

  it('accepts a label with spaces and German umlauts', () => {
    expect(parseLinks('[Störungsmeldung öffnen](https://support.example.edu/störung)')).toEqual([
      { kind: 'link', href: 'https://support.example.edu/störung', label: 'Störungsmeldung öffnen' },
    ])
  })

  it('accepts mailto and tel targets', () => {
    expect(parseLinks('[Support](mailto:support@example.edu)')).toEqual([
      { kind: 'link', href: 'mailto:support@example.edu', label: 'Support' },
    ])
    expect(parseLinks('[Hotline](tel:+495419691)')).toEqual([
      { kind: 'link', href: 'tel:+495419691', label: 'Hotline' },
    ])
  })

  it('keeps balanced parentheses inside the target', () => {
    expect(parseLinks('[Kater](https://de.wikipedia.org/wiki/Kater_(Tier))')).toEqual([
      { kind: 'link', href: 'https://de.wikipedia.org/wiki/Kater_(Tier)', label: 'Kater' },
    ])
  })

  it('leaves an empty label literal', () => {
    expect(parseLinks('[](https://evil.example)')).toEqual([text('[](https://evil.example)')])
  })
})

describe('parseLinks — scheme allowlist', () => {
  it('renders [label](javascript:…) as literal text with no link', () => {
    const src = '[Klick mich](javascript:alert(1))'
    expect(parseLinks(src)).toEqual([text(src)])
    expect(hrefs(src)).toEqual([])
  })

  it('never produces an href for a denied scheme', () => {
    for (const target of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example/pfad',
      'evil.example/pfad',
    ]) {
      expect(hrefs(`[Los](${target})`), target).toEqual([])
      expect(hrefs(`Text ${target} Text`), target).toEqual([])
    }
  })

  it('keeps the denied target visible as typed', () => {
    expect(rendered('[Los](javascript:alert(1))')).toBe('[Los](javascript:alert(1))')
    expect(rendered('Siehe //evil.example/pfad hier')).toBe('Siehe //evil.example/pfad hier')
  })

  it('does not autolink a real URL nested inside a denied target', () => {
    const src = '[Los](javascript:location=https://evil.example)'
    expect(hrefs(src)).toEqual([])
    expect(rendered(src)).toBe(src)
  })
})

describe('parseLinks — malformed input stays literal', () => {
  it('leaves an unclosed bracket literal', () => {
    expect(parseLinks('Ein [Label ohne Ende')).toEqual([text('Ein [Label ohne Ende')])
  })

  it('leaves an unclosed target literal', () => {
    expect(parseLinks('[Label](https://status.example.edu')).toEqual([
      text('[Label](https://status.example.edu'),
    ])
  })

  it('leaves a bracket that is not followed by a target literal, but still autolinks', () => {
    expect(parseLinks('[1] https://status.example.edu')).toEqual([
      text('[1] '),
      link('https://status.example.edu'),
    ])
  })

  it('leaves a target containing whitespace literal', () => {
    expect(parseLinks('[Label](https://a.example b)')).toEqual([text('[Label](https://a.example b)')])
  })

  // A label may span a newline (as it may in markdown). The alternative —
  // ending the label at the line break — would have to resume scanning *inside*
  // the leftover `](…)`, which is how a denied target could get autolinked; one
  // resume rule for every malformed case is the safer parser.
  it('accepts a label spanning a newline, keeping the break', () => {
    expect(parseLinks('[Label\nbruch](https://a.example)')).toEqual([
      { kind: 'link', href: 'https://a.example', label: 'Label\nbruch' },
    ])
  })
})

describe('parseLinks — positions and adjacency', () => {
  it('handles two labelled links back to back', () => {
    expect(parseLinks('[A](https://a.example)[B](https://b.example)')).toEqual([
      { kind: 'link', href: 'https://a.example', label: 'A' },
      { kind: 'link', href: 'https://b.example', label: 'B' },
    ])
  })

  it('handles two links separated by prose', () => {
    expect(parseLinks('[A](https://a.example) und https://b.example')).toEqual([
      { kind: 'link', href: 'https://a.example', label: 'A' },
      text(' und '),
      link('https://b.example'),
    ])
  })

  it('handles a link at the very start and at the very end', () => {
    expect(parseLinks('https://a.example mittendrin https://b.example')).toEqual([
      link('https://a.example'),
      text(' mittendrin '),
      link('https://b.example'),
    ])
  })
})

describe('parseLinks — plain text', () => {
  it('returns one text segment for a string with no link', () => {
    expect(parseLinks('Nur ganz normaler Text.')).toEqual([text('Nur ganz normaler Text.')])
  })

  it('returns nothing for an empty string', () => {
    expect(parseLinks('')).toEqual([])
  })

  it('preserves newlines, including around links', () => {
    expect(parseLinks('Zeile eins\n\nZeile zwei: https://a.example\nZeile drei')).toEqual([
      text('Zeile eins\n\nZeile zwei: '),
      link('https://a.example'),
      text('\nZeile drei'),
    ])
  })
})

describe('plainText', () => {
  it('drops the URL of a labelled link and keeps the label', () => {
    expect(plainText('Zur [Statusseite](https://status.example.edu) wechseln')).toBe(
      'Zur Statusseite wechseln',
    )
  })

  it('keeps a bare URL as it was typed', () => {
    expect(plainText('Siehe https://status.example.edu.')).toBe('Siehe https://status.example.edu.')
  })

  it('leaves a denied target exactly as typed', () => {
    expect(plainText('[Los](javascript:alert(1))')).toBe('[Los](javascript:alert(1))')
  })

  it('passes plain text and newlines through unchanged', () => {
    expect(plainText('Zeile eins\nZeile zwei')).toBe('Zeile eins\nZeile zwei')
    expect(plainText('')).toBe('')
  })
})
