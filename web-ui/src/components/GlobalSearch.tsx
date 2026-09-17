import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Search, X } from 'lucide-react'
import { t, type Lang } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'

// The launcher's global search entry point (issue #171).
//
// The field said "Dienste durchsuchen" and then answered with hits from
// outside the tab the reader was standing in. The remedy is to make the search
// *explicitly* global: it moves out of the content area and into the app bar,
// above both tabs, and says so (see i18n `searchPlaceholder`).
//
// Two things this deliberately is NOT, per the issue's settled decisions:
//
//  1. It is not a client-side filter. Typing still goes to GET /api/search,
//     which matches the admin keywords /api/catalog never ships, applies the
//     visibility narrowing, and logs search_events for the admin's zero-result
//     worklist. This component owns the *entry point* only; the query, the
//     debounce and the request stay in Dashboard.
//  2. It is not a popover or a command palette. There is no results panel here
//     and no arrow-key model: the destination is unchanged — a query replaces
//     the content area with "Suchergebnisse", where the pending/failed states,
//     the settled-count announcement (#35) and the clear-on-plain-click rule
//     (#26/#27) already live.

// The mobile entry point the issue left open was decided by measurement, not on
// paper: both were built and shot at 324×756 and 360×800 with a long
// product_name (screenshots on issue #171). Revealing the field *in the app
// bar* won over focusing one in the content area, because the content-area
// variant leaves two search controls on screen at once — the pill stays in the
// bar, inert, with no visual link to the field below it — and its field
// scrolls away, while the bar is sticky. Neither overflowed at 324, so the
// floor did not decide it.

// ── The field ───────────────────────────────────────────────────────────────

interface SearchFieldProps {
  locale: Lang
  value: string
  onChange: (next: string) => void
  /** The caller owns the ref so ⌘K / the mobile pill can focus this field. */
  inputRef?: RefObject<HTMLInputElement | null>
  /** Shows the ⌘K / Ctrl K hint. Desktop only — a phone has no such key. */
  shortcutHint?: boolean
  /** Escape, or ✕ on an already-empty field: hands control back to the caller
   *  (the phone closes the field; the desktop just blurs). */
  onDismiss?: () => void
  className?: string
}

/**
 * The search input: leading magnifier, and a trailing slot that carries the
 * keyboard hint while empty and the one-click clear (✕) while there is a query.
 *
 * One component for both entry points — the desktop bar field and the phone's
 * revealed one. It holds no state of its own.
 */
function SearchField({
  locale,
  value,
  onChange,
  inputRef,
  shortcutHint = false,
  onDismiss,
  className,
}: SearchFieldProps) {
  const tr = t(locale)
  const hasQuery = value !== ''
  const apple = isApplePlatform()

  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          // Escape is handled here rather than by the global key handler: it
          // must not travel up to whatever else listens for it, and there is
          // no overlay to close — the field simply stands down.
          e.stopPropagation()
          onDismiss?.()
        }}
        placeholder={tr.dash.searchPlaceholder}
        aria-label={tr.dash.searchLabel}
        // The shortcut is carried by aria-keyshortcuts, not by an sr-only
        // sentence: a screen reader localizes and announces the key names
        // itself, and an sr-only text node would be content announced with
        // nothing on screen to match it — the orphan issue #35 is about.
        // `title` is the same thing for a pointer user, on hover.
        {...(shortcutHint
          ? {
              'aria-keyshortcuts': apple ? 'Meta+K' : 'Control+K',
              title: tr.dash.searchShortcut(
                `${apple ? tr.dash.searchShortcutMeta : tr.dash.searchShortcutCtrl} + K`,
              ),
            }
          : {})}
        // Not the Input primitive: that one is the forms' field, sized by
        // min-h-11 / md:min-h-0 with its own padding, and this bar field is a
        // fixed h-11 / md:h-9 box with room cut out either side for the
        // magnifier and the trailing slot. Composing it would mean overriding
        // every box class it sets, which is not a reuse.
        //
        // pl-9 clears the magnifier, pr-12 the trailing slot. The 44px height
        // is the phone touch floor; the bar's own density takes over from md:.
        // text-ellipsis, not the browser's hard clip: the bar's field is
        // narrower than the in-content one it replaced, and a query longer than
        // it should trail off rather than be cut mid-glyph (the viewport
        // assertions treat a hard clip as a failure, and they are right to).
        className="h-11 w-full text-ellipsis rounded-md border border-border bg-surface pl-9 pr-12 text-sm text-text placeholder:text-text-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:h-9 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {hasQuery ? (
        // IconButton's `plain` sm box is exactly this control's box (44px, 28px
        // from md:), so the classes are the primitive's rather than re-typed.
        // Two overrides keep the rendered result identical inside the field it
        // sits in: the tighter radius, and no ring offset — an offset ring here
        // would be drawn over the input's own border two pixels away.
        <IconButton
          variant="plain"
          size="sm"
          aria-label={tr.dash.searchClear}
          onClick={() => onChange('')}
          className="absolute right-0 top-1/2 -translate-y-1/2 rounded focus-visible:ring-offset-0 md:right-1"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      ) : (
        shortcutHint && <ShortcutHint locale={locale} apple={apple} />
      )}
    </div>
  )
}

/** True on Apple platforms, where the shortcut is ⌘K rather than Ctrl K. */
function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
  return /Mac|iPhone|iPad|iPod/.test(ua)
}

/** The kbd chip in the field's trailing slot — decoration only: the spoken
 *  form is the field's own aria-keyshortcuts, because "⌘K" read aloud is not a
 *  shortcut.
 *
 *  The key's name is localized (`searchShortcutCtrl`), like the title the field
 *  carries: "Ctrl" beside a tooltip reading „Tastenkürzel: Strg + K" is two
 *  names for one key, and „Strg" is what a German keyboard has printed on it.
 *  ⌘ stays the glyph on Apple platforms — it is a symbol rather than a word,
 *  printed on a Mac keyboard in every language, and the spelled-out
 *  `searchShortcutMeta` ("Befehlstaste") is a tooltip word: in the chip it is
 *  ~90px wide and would run under the field's own text at the 260px the bar
 *  gives it. */
function ShortcutHint({ locale, apple }: { locale: Lang; apple: boolean }): ReactNode {
  const tr = t(locale)
  return (
    <kbd
      aria-hidden="true"
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-sm border border-border px-1.5 py-0.5 font-sans text-xs leading-none text-text-muted"
    >
      {apple ? '⌘K' : `${tr.dash.searchShortcutCtrl} K`}
    </kbd>
  )
}

// ── The app-bar entry point ─────────────────────────────────────────────────

interface GlobalSearchProps {
  locale: Lang
  isMobile: boolean
  value: string
  onChange: (next: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  /** Phone only: whether the field is revealed. Ignored on a desktop, where
   *  the field is simply always there. */
  open: boolean
  onOpen: () => void
  onClose: () => void
}

export function GlobalSearch({ locale, isMobile, value, onChange, inputRef, open, onOpen, onClose }: GlobalSearchProps) {
  const tr = t(locale)
  const pillRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(open)

  // Focus goes back where it came from when the overlay stands down. Without
  // this it lands on <body>: the field it was in has just been unmounted, so a
  // keyboard user's next Tab restarts at the top of the document and a screen
  // reader user is dropped out of the bar entirely. The bell and the account
  // menu already return focus to their triggers on close; the overlay owes the
  // same contract even though it is deliberately not a Dialog.
  //
  // In an effect rather than in the ✕ handler because *every* way out closes
  // it — the ✕, Escape, and the plain-click launch that clears the search from
  // Dashboard (issue #27) — and because the pill is inert while the overlay is
  // up: it only becomes focusable again in the render this effect follows.
  useEffect(() => {
    const closed = wasOpen.current && !open
    wasOpen.current = open
    if (closed) pillRef.current?.focus()
  }, [open])

  if (!isMobile) {
    // 260–320px of field, per the design. It shrinks before the wordmark does
    // (the wordmark truncates, issue #170) but never below a usable width.
    return (
      <SearchField
        locale={locale}
        value={value}
        onChange={onChange}
        inputRef={inputRef}
        shortcutHint
        onDismiss={() => inputRef.current?.blur()}
        className="w-[260px] lg:w-[300px]"
      />
    )
  }

  return (
    <>
      {/* The pill. Fully rounded per the design, and a real 44px target: it is
          now the only way to reach search on a phone, where there are no
          category chips either (Dashboard's section-head note). */}
      <button
        ref={pillRef}
        type="button"
        aria-label={tr.dash.searchPillLabel}
        aria-expanded={open}
        onClick={onOpen}
        // Covered by the overlay, so out of the tab order with it: a control a
        // reader cannot see is not one they can mean to reach. TopBar does the
        // same for the bell and the avatar beside it (`searchOpen`).
        inert={open}
        className="mr-0.5 inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-3 max-[359px]:w-11 max-[359px]:px-0 text-[13px] text-text transition-colors hover:bg-bg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        <Search className="h-[18px] w-[18px] shrink-0 text-text-muted" aria-hidden="true" />
        {/* The label goes sr-only below 360px. The bar has to hold the
            wordmark, this, the bell and the avatar on one row, and
            branding.product_name is runtime config: with a real institution's
            name the labelled pill left the wordmark 42px — "S…". 324 is the
            correctness floor, not the size the look is tuned for (CLAUDE.md),
            so the narrowest phone gets the magnifier alone and 360/390 get the
            design's "⌕ Suchen". The button stays a 44px target either way,
            and its accessible name is the aria-label, not this text, so
            dropping it costs a screen-reader user nothing. */}
        <span className="max-[359px]:hidden">{tr.dash.searchPill}</span>
      </button>

      {/* The revealed field, laid over the whole bar row rather than squeezed
          into it: at 324px a field sharing the row with the wordmark, the bell
          and the avatar is 80px wide. Absolute against <header> (sticky, so
          it is the positioned ancestor) — no restructuring of the row, and no
          Dialog, hence no focus trap and no Escape layer to get wrong. */}
      {open && (
        <div className="absolute inset-0 z-20 flex items-center gap-1 bg-bg px-4 py-2.5">
          <SearchField
            locale={locale}
            value={value}
            onChange={onChange}
            inputRef={inputRef}
            onDismiss={onClose}
            className="min-w-0 flex-1"
          />
          <IconButton aria-label={tr.dash.searchClose} onClick={onClose}>
            <X className="h-5 w-5" aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </>
  )
}

// ── ⌘K / Ctrl+K and "/" ─────────────────────────────────────────────────────

/** Elements that own the keystroke themselves — a shortcut that steals "/" out
 *  of a text field is worse than no shortcut. */
function isTypingTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * True while something is layered over the launcher: the announcement dialog,
 * the notification panel, the account menu, the sort sheet, an admin form's
 * dialog. Each of them is a role="dialog" that owns focus and Escape while it
 * is up, and a global shortcut that ignores that is exactly the layering bug
 * PR #169 fixed — so this handler defers instead of competing.
 */
function overlayOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}

/**
 * useSearchHotkeys focuses the global search field on ⌘K / Ctrl+K, and on "/"
 * when nothing is being typed into.
 *
 * `activate` must be stable (useCallback) — it is a dependency of the listener.
 */
export function useSearchHotkeys(activate: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      const meta = (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey
      if (!meta && !slash) return
      // The typing guard is "/"'s alone. A bare slash belongs to whatever is
      // being typed into; ⌘K is a chord nobody types by accident, and
      // suppressing it inside a field breaks it in the very place the field
      // advertises it — the reader who wants to start a fresh query from the
      // one they are standing in. It re-focuses and selects, so it does.
      if (slash && isTypingTarget(document.activeElement)) return
      if (overlayOpen()) return
      e.preventDefault()
      activate()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activate, enabled])
}
