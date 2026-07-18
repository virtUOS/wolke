// One-time "install this as an app" hint on smartphones (issue #42). Two
// variants: Chromium/Android captured a beforeinstallprompt event → an
// actionable install button; iOS Safari (no such event) → share-sheet
// instructions. Dismissal persists per device (lib/pwa-install). Renders
// nothing on desktop, when already installed, or after dismissal.

import { useSyncExternalStore } from 'react'
import { Smartphone } from 'lucide-react'
import { t, type Lang } from '@/lib/i18n'
import {
  dismissInstallHint,
  getInstallHintState,
  promptInstall,
  subscribeInstallHint,
} from '@/lib/pwa-install'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

export function PwaInstallHint({ isMobile, locale }: { isMobile: boolean; locale: Lang }) {
  const state = useSyncExternalStore(subscribeInstallHint, getInstallHintState)
  const s = t(locale)
  if (!isMobile || state === 'hidden') return null

  return (
    <div role="region" aria-label={s.pwa.region} aria-live="polite" style={{ marginBottom: 16 }}>
      <Alert
        variant="info"
        icon={<Smartphone className="h-4 w-4" aria-hidden="true" />}
        title={s.pwa.installTitle}
        onDismiss={dismissInstallHint}
        dismissLabel={s.pwa.dismiss}
      >
        {state === 'ios' ? (
          <p>{s.pwa.installBodyIOS}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p>{s.pwa.installBody}</p>
            <Button size="sm" onClick={() => void promptInstall()}>
              {s.pwa.installButton}
            </Button>
          </div>
        )}
      </Alert>
    </div>
  )
}
