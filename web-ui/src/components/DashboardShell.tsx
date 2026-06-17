import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { Me } from '@/lib/api'
import type { Branding } from '@/lib/branding'
import { t } from '@/lib/i18n'
import { TopBar, type Tab } from './TopBar'

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

interface DashboardShellProps {
  branding: Branding
  me: Me
  tab: Tab
  onTab: (t: Tab) => void
  isDark: boolean
  onToggleTheme: () => void
  onAdmin: () => void
  isMobile: boolean
  /** Identifies the current view; when it changes, focus moves to <main> so a
   *  view switch (e.g. opening/closing Admin) isn't lost to <body>. */
  focusKey: string
  children: ReactNode
}

// The warm-canvas + sticky TopBar + centered <main> chrome shared by every
// dashboard view (the catalog tabs and the admin surface), so the shell — and
// the logout handler — live in one place instead of being duplicated per branch.
export function DashboardShell({
  branding,
  me,
  tab,
  onTab,
  isDark,
  onToggleTheme,
  onAdmin,
  isMobile,
  focusKey,
  children,
}: DashboardShellProps) {
  const s = t(branding.default_locale || 'de')
  const mainRef = useRef<HTMLElement>(null)
  const prevKey = useRef(focusKey)

  // On a view change (not the initial mount) move focus to <main> so keyboard /
  // screen-reader users land on the new content instead of being dropped to the
  // top of the document.
  useEffect(() => {
    if (prevKey.current !== focusKey) {
      prevKey.current = focusKey
      mainRef.current?.focus()
    }
  }, [focusKey])

  const canvasStyle: CSSProperties = {
    minHeight: '100vh',
    background: isDark
      ? 'color-mix(in srgb, var(--accent) 7%, var(--bg))'
      : 'color-mix(in srgb, var(--accent) 5%, var(--bg))',
    color: 'var(--text)',
  }

  return (
    <div style={canvasStyle}>
      {/* Skip link: first focusable element, visible only when focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-bg focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        {s.common.skipToContent}
      </a>
      <TopBar
        branding={branding}
        tab={tab}
        onTab={onTab}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        userInitials={initials(me.display_name)}
        userName={me.display_name}
        userEmail={me.email}
        isAdmin={me.is_admin}
        onAdmin={onAdmin}
        onLogout={() => void fetch('/auth/logout', { method: 'POST' }).finally(() => window.location.assign('/'))}
      />
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="focus:outline-none"
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: isMobile ? '20px 16px 32px' : '28px 24px 40px',
        }}
      >
        {children}
      </main>
    </div>
  )
}
