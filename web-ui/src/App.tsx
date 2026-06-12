import { useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { applyBrandingTokens, applySystemTheme, fetchBranding, type Branding } from '@/lib/branding'

export default function App() {
  const [branding, setBranding] = useState<Branding | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    applySystemTheme()
    fetchBranding(ctrl.signal)
      .then((b) => {
        applyBrandingTokens(b)
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

  if (failed) {
    return (
      <div role="alert" className="p-6 text-sm">
        Die Konfiguration konnte nicht geladen werden.
      </div>
    )
  }
  if (!branding) {
    return (
      <div aria-busy="true" className="p-6 text-sm">
        Lädt…
      </div>
    )
  }
  return <AppShell branding={branding} />
}
