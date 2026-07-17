import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Bot, Languages, MessageCircleQuestionMark, Moon, Shield, Sun, LogOut } from 'lucide-react'
import { assistantEnabled, contactHref, type Branding } from '@/lib/branding'
import { t, type Lang } from '@/lib/i18n'
import type { Me } from '@/lib/api'
import { iconButtonVariants } from '@/components/ui/icon-button'
import { PillButton } from '@/components/ui/pill-button'
import { focusFirst, trapTab } from '@/lib/focus'
import { NotificationBell } from './NotificationBell'

export type Tab = 'favoriten' | 'dienste'

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
  isDark: boolean
  onToggleTheme: () => void
  onSetLocale: (locale: Me['locale']) => void
  userInitials: string
  userName: string
  userEmail?: string
  isAdmin: boolean
  onAdmin: () => void
  onLogout: () => void
}

// Editorial sticky top bar: translucent blur, hairline bottom, logo + tabs +
// theme toggle + avatar-triggered account menu.
export function TopBar({
  branding,
  locale,
  currentLocalePref,
  tab,
  onTab,
  isDark,
  onToggleTheme,
  onSetLocale,
  userInitials,
  userName,
  userEmail,
  isAdmin,
  onAdmin,
  onLogout,
}: TopBarProps) {
  const s = t(locale)
  const help = contactHref(branding.help_url)
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

        {/* Tabs */}
        {/* View switcher. These are nav controls, not an ARIA tablist (there's no
            tabpanel/arrow-key model behind them), so they signal state with
            aria-current — consistent with the admin nav. */}
        <nav aria-label={s.topbar.mainNav} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <PillButton
            active={tab === 'favoriten'}
            aria-current={tab === 'favoriten' ? 'page' : undefined}
            onClick={() => onTab('favoriten')}
          >
            {s.topbar.favorites}
          </PillButton>
          <PillButton
            active={tab === 'dienste'}
            aria-current={tab === 'dienste' ? 'page' : undefined}
            onClick={() => onTab('dienste')}
          >
            {s.topbar.services}
          </PillButton>
        </nav>

        <div style={{ flex: 1 }} />

        {/* Actions. The chatbot + help buttons each appear only when their link
            is configured (branding.bot_url / help_url). The bot link is
            superseded by the embedded assistant launcher when that is
            configured. The theme toggle now lives in the account menu. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {branding.bot_url && !assistantEnabled(branding) && (
            <a
              href={branding.bot_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={s.topbar.bot}
              className={iconButtonVariants()}
            >
              <Bot className="h-5 w-5" aria-hidden="true" />
            </a>
          )}
          {help && (
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
            isDark={isDark}
            onToggleTheme={onToggleTheme}
            initials={userInitials}
            name={userName}
            email={userEmail}
            isAdmin={isAdmin}
            onAdmin={onAdmin}
            onLogout={onLogout}
          />
        </div>
      </div>
    </header>
  )
}

// ── Account menu ────────────────────────────────────────────────────────────

interface AccountMenuProps {
  locale: Lang
  currentLocalePref: Me['locale']
  onSetLocale: (locale: Me['locale']) => void
  isDark: boolean
  onToggleTheme: () => void
  initials: string
  name: string
  email?: string
  isAdmin: boolean
  onAdmin: () => void
  onLogout: () => void
}

function AccountMenu({ locale, currentLocalePref, onSetLocale, isDark, onToggleTheme, initials, name, email, isAdmin, onAdmin, onLogout }: AccountMenuProps) {
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
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={s.topbar.openAccount}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'grid', placeItems: 'center',
          width: 26, height: 26, borderRadius: '50%', border: 'none',
          background: 'color-mix(in srgb, var(--accent) 38%, var(--surface))',
          color: 'var(--text)', fontSize: 11, fontWeight: 700, letterSpacing: '.02em',
          cursor: 'pointer', padding: 0,
        }}
        className="focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-1"
      >
        {initials}
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
            width: 244,
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

          {/* Theme toggle (moved here from the top bar). */}
          <button
            type="button"
            style={itemStyle}
            aria-pressed={isDark}
            className="hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            onClick={onToggleTheme}
          >
            {isDark ? (
              <Sun className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
            ) : (
              <Moon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
            )}
            <span style={{ flex: 1 }}>{isDark ? s.topbar.toLight : s.topbar.toDark}</span>
          </button>

          {/* Language switcher: persists as a user pref (locale: auto | de | en).
              'auto' defers to the browser; de/en pin the language. */}
          <div style={{ ...itemStyle, cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--text-muted)', fontSize: 12 }}>
              <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
              {s.topbar.language}
            </span>
            <div role="group" aria-label={s.topbar.language} style={{ display: 'flex', gap: 4, width: '100%' }}>
              {(
                [
                  ['auto', s.topbar.langAuto],
                  ['de', s.topbar.langDe],
                  ['en', s.topbar.langEn],
                ] as const
              ).map(([value, label]) => {
                const active = currentLocalePref === value
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSetLocale(value)}
                    style={{
                      flex: 1, padding: '5px 6px', fontSize: 12.5, lineHeight: 1.2,
                      borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: active ? 'color-mix(in srgb, var(--accent) 38%, var(--surface))' : 'transparent',
                      color: 'var(--text)', fontWeight: active ? 600 : 400,
                    }}
                    className="hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} aria-hidden="true" />

          {isAdmin && (
            <button
              type="button"
              style={itemStyle}
              className="hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
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
            className="hover:bg-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
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
