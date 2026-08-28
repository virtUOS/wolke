import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Bot, Languages, MessageCircleQuestionMark, Shield, SunMoon, LogOut } from 'lucide-react'
import { assistantEnabled, contactHref, type Branding } from '@/lib/branding'
import { t, type Lang } from '@/lib/i18n'
import type { Me } from '@/lib/api'
import { iconButtonVariants } from '@/components/ui/icon-button'
import { PillButton } from '@/components/ui/pill-button'
import { focusFirst, trapTab } from '@/lib/focus'
import { NotificationBell } from './NotificationBell'

// Tab lives in the view-url lib (it is part of the URL-serialized view state);
// re-exported here so the chrome's consumers keep importing it from TopBar.
export type { Tab } from '@/lib/view-url'
import type { Tab } from '@/lib/view-url'

interface TopBarProps {
  branding: Branding
  /** The active locale used to render chrome (resolved upstream). */
  locale: Lang
  /** The user's raw preference ('auto' | 'de' | 'en'), for the switcher's state. */
  currentLocalePref: Me['locale']
  /** The active section, or null when none is (e.g. while a search is active —
   *  search results are their own view, so neither tab is highlighted). */
  tab: Tab | null
  onTab: (t: Tab) => void
  theme: Me['theme']
  onSetTheme: (next: Me['theme']) => void
  onSetLocale: (locale: Me['locale']) => void
  userInitials: string
  userName: string
  userEmail?: string
  isAdmin: boolean
  onAdmin: () => void
  onLogout: () => void
  /** Phone layout (below the MOBILE_BREAKPOINT_PX breakpoint, src/lib/breakpoints.ts):
   *  the bar is two rows and the quick links move into the account menu — see
   *  the layout note below. */
  isMobile: boolean
}

// Editorial sticky top bar: translucent blur, hairline bottom, logo + tabs +
// theme toggle + avatar-triggered account menu.
export function TopBar({
  branding,
  locale,
  currentLocalePref,
  tab,
  onTab,
  theme,
  onSetTheme,
  onSetLocale,
  userInitials,
  userName,
  userEmail,
  isAdmin,
  onAdmin,
  onLogout,
  isMobile,
}: TopBarProps) {
  const s = t(locale)
  const help = contactHref(branding.help_url)
  const bot = branding.bot_url && !assistantEnabled(branding) ? branding.bot_url : ''

  // View switcher. These are nav controls, not an ARIA tablist (there's no
  // tabpanel/arrow-key model behind them), so they signal state with
  // aria-current — consistent with the admin nav. On a phone it is a full-width
  // segmented control on its own row (docs/03 §4): the two German labels plus
  // the logo and the actions do not fit one 324px row, and squeezing them was
  // what pushed the whole document into horizontal scroll (issue #23).
  const tabs = (
    <nav
      aria-label={s.topbar.mainNav}
      style={{ display: 'flex', gap: 4, alignItems: 'center', width: isMobile ? '100%' : undefined }}
    >
      <PillButton
        active={tab === 'favoriten'}
        aria-current={tab === 'favoriten' ? 'page' : undefined}
        onClick={() => onTab('favoriten')}
        className={isMobile ? 'min-h-11 flex-1' : undefined}
      >
        {s.topbar.favorites}
      </PillButton>
      <PillButton
        active={tab === 'dienste'}
        aria-current={tab === 'dienste' ? 'page' : undefined}
        onClick={() => onTab('dienste')}
        className={isMobile ? 'min-h-11 flex-1' : undefined}
      >
        {s.topbar.services}
      </PillButton>
    </nav>
  )

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 1180, margin: '0 auto' }}
        className="px-4 py-2.5 md:px-6 md:py-3"
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginRight: 4 }}>
          <picture className="shrink-0">
            <source srcSet={branding.logo_dark} media="(prefers-color-scheme: dark)" />
            <img src={branding.logo_light} alt="" className="h-6" aria-hidden="true" />
          </picture>
          <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            {branding.product_name}
          </span>
        </div>

        {!isMobile && tabs}

        <div style={{ flex: 1 }} />

        {/* Actions. The chatbot + help links each appear only when configured
            (branding.bot_url / help_url); the bot link is superseded by the
            embedded assistant launcher when that is set. On a phone both move
            into the account menu, along with the theme toggle — the row has to
            fit 324px. `position: relative` makes this row, not the individual
            trigger, the anchor for the two panels below it: anchored to a
            trigger, a 360px panel hangs off the left edge of a narrow phone. */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
          {!isMobile && bot && (
            <a
              href={bot}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.topbar.bot}
              className={iconButtonVariants()}
            >
              <Bot className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          {!isMobile && help && (
            <a
              href={help.href}
              {...(help.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              aria-label={s.topbar.help}
              className={iconButtonVariants()}
            >
              <MessageCircleQuestionMark className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          <NotificationBell locale={locale} />
          <AccountMenu
            locale={locale}
            currentLocalePref={currentLocalePref}
            onSetLocale={onSetLocale}
            theme={theme}
            onSetTheme={onSetTheme}
            initials={userInitials}
            name={userName}
            email={userEmail}
            isAdmin={isAdmin}
            onAdmin={onAdmin}
            onLogout={onLogout}
            botUrl={isMobile ? bot : ''}
            help={isMobile ? help ?? undefined : undefined}
          />
        </div>
      </div>
      {isMobile && <div className="px-4 pb-2.5">{tabs}</div>}
    </header>
  )
}

// ── Account menu ────────────────────────────────────────────────────────────

interface AccountMenuProps {
  /** Set on a phone: the top-bar chatbot link, moved in here. Empty = omit. */
  botUrl: string
  /** Set on a phone: the top-bar help link, moved in here. */
  help?: { href: string; external: boolean }
  locale: Lang
  currentLocalePref: Me['locale']
  onSetLocale: (locale: Me['locale']) => void
  theme: Me['theme']
  onSetTheme: (next: Me['theme']) => void
  initials: string
  name: string
  email?: string
  isAdmin: boolean
  onAdmin: () => void
  onLogout: () => void
}

// The theme and language switchers are both a labelled group of pill buttons
// over a small set of (value, label) options, differing only in the options
// and the setter — one component instead of two near-identical button blocks.
function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, width: '100%' }}>
      {options.map(([optionValue, optionLabel]) => {
        const active = value === optionValue
        return (
          <button
            key={optionValue}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(optionValue)}
            style={{
              display: 'grid', placeItems: 'center',
              flex: '1 1 auto', padding: '5px 6px', fontSize: 12.5, lineHeight: 1.2,
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              border: '1px solid var(--border)',
              background: active ? 'color-mix(in srgb, var(--accent) 38%, var(--surface))' : 'transparent',
              color: 'var(--text)', fontWeight: active ? 600 : 400,
            }}
            className="min-h-11 min-w-11 hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:min-h-0 md:min-w-0"
          >
            {optionLabel}
          </button>
        )
      })}
    </div>
  )
}

function AccountMenu({ botUrl, help, locale, currentLocalePref, onSetLocale, theme, onSetTheme, initials, name, email, isAdmin, onAdmin, onLogout }: AccountMenuProps) {
  const s = t(locale)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    // role="dialog" promises focus containment: move focus into the panel on
    // open and trap Tab within it (Escape/outside-click still dismiss).
    focusFirst(panelRef.current)
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); return }
      trapTab(e, panelRef.current)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
    fontSize: 13.5, color: 'var(--text)', textDecoration: 'none', cursor: 'pointer',
    background: 'transparent', border: 'none', font: 'inherit',
    padding: '8px 8px', margin: '0 -6px', borderRadius: 'var(--radius-sm)',
    transition: 'background-color .12s ease',
  }

  return (
    // Not positioned: the panel anchors to the actions row above, which is what
    // keeps it inside the viewport on a narrow phone.
    <div ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={s.topbar.openAccount}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
        // The disc stays 26px; the button around it is a 44px touch target on a
        // phone and collapses to the disc from `md` up (docs/03 §4).
        className="h-11 w-11 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-1 md:h-[26px] md:w-[26px]"
      >
        <span
          style={{
            display: 'grid', placeItems: 'center',
            width: 26, height: 26, borderRadius: '50%',
            background: 'color-mix(in srgb, var(--accent) 38%, var(--surface))',
            color: 'var(--text)', fontSize: 12, fontWeight: 700, letterSpacing: '.02em',
          }}
        >
          {initials}
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          ref={panelRef}
          role="dialog"
          aria-label={s.topbar.account}
          tabIndex={-1}
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 20,
            width: 'min(244px, calc(100vw - 24px))',
            // The 44px mobile touch targets on the rows and pills (issue #28)
            // make the panel taller than a short phone viewport can fit —
            // scroll it internally rather than letting it clip or push past
            // the bottom edge.
            maxHeight: 'calc(100dvh - 88px)', overflowY: 'auto',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', boxShadow: '0 12px 32px -12px rgba(0,0,0,.25)',
            padding: '12px',
          }}
        >
          {/* Identity block */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8 }}>
            <span
              aria-hidden="true"
              style={{
                display: 'grid', placeItems: 'center', width: 34, height: 34,
                borderRadius: '50%', flexShrink: 0,
                background: 'color-mix(in srgb, var(--accent) 38%, var(--surface))',
                color: 'var(--text)', fontSize: 13, fontWeight: 700, letterSpacing: '.02em',
              }}
            >
              {initials}
            </span>
            <div style={{ minWidth: 0, lineHeight: 1.3 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>{name}</div>
              {email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{email}</div>}
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '0 0 4px' }} aria-hidden="true" />

          {/* Theme: a three-way group mirroring the language switcher below it
              (issue #28) — 'auto' follows prefers-color-scheme, 'light'/'dark'
              pin it. */}
          <div style={{ ...itemStyle, cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--text-muted)', fontSize: 12 }}>
              <SunMoon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {s.topbar.theme}
            </span>
            <OptionGroup
              label={s.topbar.theme}
              value={theme}
              onChange={onSetTheme}
              options={
                [
                  ['system', s.topbar.themeAuto],
                  ['light', s.topbar.themeLight],
                  ['dark', s.topbar.themeDark],
                ] as const
              }
            />
          </div>

          {/* Language switcher: persists as a user pref (locale: auto | de | en).
              'auto' defers to the browser; de/en pin the language. */}
          <div style={{ ...itemStyle, cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--text-muted)', fontSize: 12 }}>
              <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
              {s.topbar.language}
            </span>
            {/* Wraps rather than forcing three equal columns: at the panel's width
                the three German/English labels don't fit one row, and equal
                columns made the last one overflow the panel by a few px. */}
            <OptionGroup
              label={s.topbar.language}
              value={currentLocalePref}
              onChange={onSetLocale}
              options={
                [
                  ['auto', s.topbar.langAuto],
                  ['de', s.topbar.langDe],
                  ['en', s.topbar.langEn],
                ] as const
              }
            />
          </div>

          {/* Chatbot + help: top-bar icons on a desktop, menu items on a phone. */}
          {(botUrl || help) && (
            <>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} aria-hidden="true" />
              {botUrl && (
                <a
                  href={botUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={itemStyle}
                  className="min-h-11 hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:min-h-0"
                >
                  <Bot className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span style={{ flex: 1 }}>{s.topbar.bot}</span>
                </a>
              )}
              {help && (
                <a
                  href={help.href}
                  {...(help.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  style={itemStyle}
                  className="min-h-11 hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:min-h-0"
                >
                  <MessageCircleQuestionMark className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                  <span style={{ flex: 1 }}>{s.topbar.help}</span>
                </a>
              )}
            </>
          )}

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} aria-hidden="true" />

          {isAdmin && (
            <button
              type="button"
              style={itemStyle}
              className="min-h-11 hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:min-h-0"
              onClick={() => { setOpen(false); onAdmin() }}
            >
              <Shield className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span style={{ flex: 1 }}>{s.topbar.administration}</span>
              <ArrowRight className="h-[15px] w-[15px] shrink-0 text-text-muted" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            style={itemStyle}
            className="min-h-11 hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:min-h-0"
            onClick={() => { setOpen(false); onLogout() }}
          >
            <LogOut className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
            <span style={{ flex: 1 }}>{s.topbar.logout}</span>
          </button>
        </div>
      )}
    </div>
  )
}
