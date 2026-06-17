import type { CSSProperties, ReactNode } from 'react'
import type { Me } from '@/lib/api'
import type { Branding } from '@/lib/branding'
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
  children,
}: DashboardShellProps) {
  const canvasStyle: CSSProperties = {
    minHeight: '100vh',
    background: isDark
      ? 'color-mix(in srgb, var(--accent) 7%, var(--bg))'
      : 'color-mix(in srgb, var(--accent) 5%, var(--bg))',
    color: 'var(--text)',
  }

  return (
    <div style={canvasStyle}>
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
