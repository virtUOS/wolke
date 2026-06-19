import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Moon, Shield, Sun, LogOut } from 'lucide-react'
import type { Branding } from '@/lib/branding'
import { t } from '@/lib/i18n'
import { IconButton } from '@/components/ui/icon-button'
import { PillButton } from '@/components/ui/pill-button'
import { focusFirst, trapTab } from '@/lib/focus'

export type Tab = 'favoriten' | 'dienste'

interface TopBarProps {
  branding: Branding
  tab: Tab
  onTab: (t: Tab) => void
  isDark: boolean
  onToggleTheme: () => void
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
  tab,
  onTab,
  isDark,
  onToggleTheme,
  userInitials,
  userName,
  userEmail,
  isAdmin,
  onAdmin,
  onLogout,
}: TopBarProps) {
  const locale = branding.default_locale || 'de'
  const s = t(locale)
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

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton
            aria-label={isDark ? s.topbar.toLight : s.topbar.toDark}
            aria-pressed={isDark}
            onClick={onToggleTheme}
          >
            {isDark ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
          </IconButton>
          <AccountMenu
            locale={locale}
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
  locale: string
  initials: string
  name: string
  email?: string
  isAdmin: boolean
  onAdmin: () => void
  onLogout: () => void
}

function AccountMenu({ locale, initials, name, email, isAdmin, onAdmin, onLogout }: AccountMenuProps) {
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
