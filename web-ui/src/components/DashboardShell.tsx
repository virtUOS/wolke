import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { Me } from '@/lib/api'
import type { Branding } from '@/lib/branding'
import { t, type Lang } from '@/lib/i18n'
import { TopBar, type Tab } from './TopBar'

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

// Single sign-out must be a top-level navigation, not fetch(): /auth/logout 302s
// to the IdP's end-session endpoint, and only a real navigation carries the IdP's
// cookies so it can terminate the SSO session. A background fetch follows that
// cross-origin redirect with same-origin credentials, leaving the IdP session
// alive — so we'd be silently logged straight back in. A POST form keeps the
// route POST-only (CSRF-safe) while navigating the top frame through the redirect.
function logout() {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/auth/logout'
  document.body.appendChild(form)
  form.submit()
}

interface DashboardShellProps {
  branding: Branding
  me: Me
  /** The active locale, resolved once in Dashboard and threaded down. */
  locale: Lang
  tab: Tab
  onTab: (t: Tab) => void
  isDark: boolean
  onToggleTheme: () => void
  onSetLocale: (locale: Me['locale']) => void
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
  locale,
  tab,
  onTab,
  isDark,
  onToggleTheme,
  onSetLocale,
  onAdmin,
  isMobile,
  focusKey,
  children,
}: DashboardShellProps) {
  const s = t(locale)
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

  // Flex column so the footer is pushed to the bottom of the viewport when the
  // content is short (sticky-footer pattern); <main> takes the slack.
  const canvasStyle: CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
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
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-bg focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      >
        {s.common.skipToContent}
      </a>
      <TopBar
        branding={branding}
        locale={locale}
        currentLocalePref={me.locale}
        tab={tab}
        onTab={onTab}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        onSetLocale={onSetLocale}
        userInitials={initials(me.display_name)}
        userName={me.display_name}
        userEmail={me.email}
        isAdmin={me.is_admin}
        onAdmin={onAdmin}
        onLogout={logout}
      />
      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="focus:outline-hidden"
        style={{
          flexGrow: 1,
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          boxSizing: 'border-box',
          padding: isMobile ? '20px 16px 32px' : '28px 24px 40px',
        }}
      >
        {children}
      </main>
      {(branding.imprint_url || branding.privacy_url) && (
        <footer
          aria-label={s.footer.legal}
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            width: '100%',
            boxSizing: 'border-box',
            padding: isMobile ? '0 16px 24px' : '0 24px 32px',
          }}
        >
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 20,
              borderTop: '1px solid var(--border)', paddingTop: 16,
            }}
          >
            {branding.imprint_url && (
              <a
                href={branding.imprint_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded text-sm text-text-muted no-underline transition-colors hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                {s.footer.imprint}
              </a>
            )}
            {branding.privacy_url && (
              <a
                href={branding.privacy_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded text-sm text-text-muted no-underline transition-colors hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                {s.footer.privacy}
              </a>
            )}
          </div>
        </footer>
      )}
    </div>
  )
}
