import { useEffect, useState } from 'react'
import { Dashboard } from '@/components/Dashboard'
import { useMe } from '@/lib/hooks'
import { ApiError } from '@/lib/api'
import { applyBrandingTokens, applySystemTheme, fetchBranding, type Branding } from '@/lib/branding'
import { resolveLocale, t } from '@/lib/i18n'

export default function App() {
  const [branding, setBranding] = useState<Branding | null>(null)
  const [failed, setFailed] = useState(false)
  const me = useMe()
  // The app shell (loading/error states) renders before branding or the user's
  // locale pref are known, so it picks the language from the browser, falling
  // back to branding.default_locale once that has loaded.
  const s = t(resolveLocale(branding?.default_locale))

  // No session → bounce to the BFF login (docs/01 §6: login is always required).
  // In the embedded build the server redirects before the SPA loads; in the Vite
  // dev loop the SPA is served directly, so it must handle the 401 itself.
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401
  useEffect(() => {
    if (unauthenticated) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.assign(`/auth/login?return_to=${returnTo}`)
    }
  }, [unauthenticated])

  useEffect(() => {
    const ctrl = new AbortController()
    applySystemTheme()
    fetchBranding(ctrl.signal)
      .then((b) => {
        applyBrandingTokens(b)
        // Keep <html lang> in sync with the resolved UI locale so screen readers
        // and the browser announce the right language (index.html ships lang="de").
        document.documentElement.lang = resolveLocale(b.default_locale)
        setBranding(b)
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          console.error(err)
          setFailed(true)
        }
      })
    return () => ctrl.abort()
  }, [])

  if (unauthenticated) {
    return (
      <div aria-busy="true" className="p-6 text-sm">
        {s.shell.signingIn}
      </div>
    )
  }

  // A non-401 error from /api/me usually means auth isn't configured on the
  // server (e.g. running without OIDC). Surface a hint rather than a blank fail.
  if (failed || me.isError) {
    return (
      <div role="alert" className="p-6 text-sm">
        <p>{s.shell.loadError}</p>
        <p className="mt-2 text-text-muted">{s.shell.loadErrorHint}</p>
      </div>
    )
  }
  if (!branding || me.isLoading || !me.data) {
    return (
      <div aria-busy="true" className="p-6 text-sm">
        {s.common.loading}
      </div>
    )
  }
  return <Dashboard branding={branding} me={me.data} />
}
