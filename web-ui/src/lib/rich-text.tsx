import { Fragment } from 'react'
import { cn } from '@/lib/utils'

// Announcement bodies are plain text in the database (issue #168) — the two link
// forms below are recognised here, at render time, so a notice written before
// this existed still renders, and a body containing a stray `[` or `:` is never
// rejected by the server. Deliberately *not* markdown: bare URLs and
// `[label](url)`, nothing else.
//
// Two rules make this safe:
//   • No `dangerouslySetInnerHTML` anywhere. The text is parsed into segments
//     and rendered as React elements, so author text can never become markup.
//   • The scheme allowlist below is the defence against `javascript:` hrefs —
//     React does not reliably block them. A target that is not on the list is
//     rendered as the literal characters the author typed.

/** A parsed piece of a body: literal text, or a link with a safe href. */
export type Segment = { kind: 'text'; text: string } | { kind: 'link'; href: string; label: string }

/** Schemes that may become an `href`; matched after lowercasing. Anything else
 *  — notably `javascript:`, `data:`, `vbscript:` and scheme-relative `//host`
 *  — stays literal text. */
const ALLOWED_SCHEMES = ['https://', 'http://', 'mailto:', 'tel:'] as const

/** Characters that end a bare URL run. Whitespace ends it; the bracketing
 *  characters would never be typed inside one in prose. */
const STOP_CHAR = /[\s<>"«»]/

/** Sentence punctuation an author's URL never ends with, stripped from the href
 *  (it stays in the surrounding text). */
const TRAILING_PUNCT = /[.,;:!?…'"“”„‚’*_~]$/

/** A character before a scheme that means the scheme is part of a longer token
 *  ("Hotel: 1234", "xhttps://…") rather than the start of a URL. */
const WORDISH = /[A-Za-z0-9+.\-/]/

/** True when `target` carries an allowlisted scheme *and* something after it. */
function isAllowedHref(target: string): boolean {
  const lower = target.toLowerCase()
  return ALLOWED_SCHEMES.some((s) => lower.startsWith(s) && target.length > s.length)
}

/** The allowlisted scheme starting at `i`, or null. */
function schemeAt(src: string, i: number): string | null {
  const head = src.slice(i, i + 8).toLowerCase()
  return ALLOWED_SCHEMES.find((s) => head.startsWith(s)) ?? null
}

function occurrences(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

/**
 * Drops punctuation that belongs to the sentence rather than the URL: a
 * trailing `.`/`,`/`!`, and a closing bracket that has no opener inside the URL
 * — so "(siehe https://x/plan)" links `…/plan` while
 * "https://de.wikipedia.org/wiki/Kater_(Tier)" keeps its own `)`.
 */
function trimTrailingPunctuation(url: string): string {
  let out = url
  for (;;) {
    const before = out
    out = out.replace(TRAILING_PUNCT, '')
    if (out.endsWith(')') && occurrences(out, ')') > occurrences(out, '(')) out = out.slice(0, -1)
    if (out.endsWith(']') && occurrences(out, ']') > occurrences(out, '[')) out = out.slice(0, -1)
    if (out === before) return out
  }
}

/** The bare URL starting at `i`, or null when it is only a bare scheme. */
function bareUrlAt(src: string, i: number): string | null {
  let end = i
  while (end < src.length && !STOP_CHAR.test(src[end])) end++
  const url = trimTrailingPunctuation(src.slice(i, end))
  return isAllowedHref(url) ? url : null
}

/**
 * The outcome of a `[label](target)` attempt at `at`.
 *
 * `null` means there is no construct here at all (no `](` follows the bracket),
 * so the bracket is ordinary prose. Otherwise the construct is consumed up to
 * `end`: with a `segment` when it is a usable link, without one when it must
 * stay literal — an empty label, a denied scheme, or an unterminated target.
 * Consuming the span in the denied case is what stops a URL *inside* a
 * rejected target ("[x](javascript:location=https://evil.example)") from being
 * autolinked on the next pass.
 */
interface LabelledLink {
  end: number
  segment: Segment | null
}

function parseLabelled(src: string, at: number): LabelledLink | null {
  // The label runs to the next `]`; a nested `[` means this is not a link.
  let close = at + 1
  while (close < src.length && src[close] !== ']' && src[close] !== '[') close++
  if (close >= src.length || src[close] === '[') return null
  if (src[close + 1] !== '(') return null

  const label = src.slice(at + 1, close)
  // Balanced-paren scan, so a target may contain "(…)" (Wikipedia-style).
  let depth = 1
  for (let k = close + 2; k < src.length; k++) {
    const c = src[k]
    // A target never contains whitespace: this is a malformed construct, and
    // only the part up to here is literal.
    if (/\s/.test(c)) return { end: k, segment: null }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth > 0) continue
      const target = src.slice(close + 2, k)
      const end = k + 1
      if (label.trim() === '' || !isAllowedHref(target)) return { end, segment: null }
      return { end, segment: { kind: 'link', href: target, label } }
    }
  }
  return { end: src.length, segment: null }
}

/**
 * Splits a plain-text body into text and link segments. Locale-independent:
 * both localizations of a body go through the same parser.
 */
export function parseLinks(src: string): Segment[] {
  const out: Segment[] = []
  let runStart = 0
  const flush = (end: number) => {
    if (end > runStart) out.push({ kind: 'text', text: src.slice(runStart, end) })
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '[') {
      const labelled = parseLabelled(src, i)
      if (labelled === null) {
        i++
        continue
      }
      if (labelled.segment) {
        flush(i)
        out.push(labelled.segment)
        runStart = labelled.end
      }
      i = labelled.end
      continue
    }
    // Cheap gate before the slice: every allowlisted scheme starts with one of
    // these letters.
    if ('hHmMtT'.includes(c) && !(i > 0 && WORDISH.test(src[i - 1]))) {
      const scheme = schemeAt(src, i)
      if (scheme) {
        const url = bareUrlAt(src, i)
        if (url) {
          flush(i)
          out.push({ kind: 'link', href: url, label: url })
          i += url.length
          runStart = i
          continue
        }
        // A bare scheme with nothing after it — skip past it so its own
        // characters can't be rescanned as another candidate.
        i += scheme.length
        continue
      }
    }
    i++
  }
  flush(src.length)
  return out
}

/**
 * The body as text, with links flattened to what a reader sees: a labelled link
 * keeps only its label, a bare URL keeps the URL. This is what surfaces that
 * cannot hold an anchor use — the notification history row lives inside a
 * `<button>`, where a nested link would be invalid HTML and an a11y bug.
 */
export function plainText(src: string): string {
  return parseLinks(src)
    .map((s) => (s.kind === 'text' ? s.text : s.label))
    .join('')
}

/** True for a scheme that should open in a new tab (the app-wide convention). */
function opensInNewTab(href: string): boolean {
  const lower = href.toLowerCase()
  return lower.startsWith('https://') || lower.startsWith('http://')
}

// Anchor styling: underline (the affordance in prose — colour alone would fail
// inside a severity-tinted Alert) and `overflow-wrap: anywhere`, which is
// stronger than the `break-word` of .hyphenate-compound and is what actually
// breaks a pasted 120-character URL at 324px. The inline-block box carries the
// 44px touch floor on a phone and hands back to plain inline text from `md` up.
const LINK_CLASS = cn(
  'inline-block min-h-11 min-w-11 py-2.5 align-baseline font-medium underline underline-offset-2',
  '[overflow-wrap:anywhere] hover:decoration-2',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
  'md:min-h-0 md:min-w-0 md:py-0',
)

/**
 * Renders a plain-text body with its links as real anchors. A Fragment, not a
 * wrapper element: the banner wraps its body one way and the history dialog
 * another (`whitespace-pre-wrap`), and neither may change.
 */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {parseLinks(text).map((seg, idx) =>
        seg.kind === 'text' ? (
          <Fragment key={idx}>{seg.text}</Fragment>
        ) : (
          <a
            key={idx}
            href={seg.href}
            className={LINK_CLASS}
            {...(opensInNewTab(seg.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {seg.label}
          </a>
        ),
      )}
    </>
  )
}
