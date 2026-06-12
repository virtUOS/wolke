import { useEffect, useState } from 'react'
import { Dashboard } from '@/components/Dashboard'
import { useMe } from '@/lib/hooks'
import { applyBrandingTokens, applySystemTheme, fetchBranding, type Branding } from '@/lib/branding'

export default function App() {
  const [branding, setBranding] = useState<Branding | null>(null)
  const [failed, setFailed] = useState(false)
  const me = useMe()

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

  if (failed || me.isError) {
    return (
      <div role="alert" className="p-6 text-sm">
        Die Anwendung konnte nicht geladen werden. Bitte lade die Seite neu.
      </div>
    )
  }
  if (!branding || me.isLoading || !me.data) {
    return (
      <div aria-busy="true" className="p-6 text-sm">
        Lädt…
      </div>
    )
  }
  return <Dashboard branding={branding} me={me.data} />
}
