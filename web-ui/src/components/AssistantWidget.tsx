// AssistantWidget embeds the configured assistant chat widget (eule) in
// launcher mode: a floating button that opens a chat panel. The widget is an
// external, Shadow-DOM-isolated bundle loaded from branding.assistant_widget_url
// (its origin is CSP-allowlisted by the backend); we mount it programmatically
// so language and theme follow the dashboard. It renders nothing itself and
// must never break the dashboard when the assistant deployment is down.

import { useEffect } from 'react'
import type { Lang } from '@/lib/i18n'
import { SHELL_MAX_WIDTH } from './DashboardShell'

interface AssistantInstance {
  dispose(): void
}

interface AssistantGlobal {
  mount(options: {
    botId: string
    baseUrl?: string
    mode?: 'launcher' | 'inline' | 'standalone'
    lang?: Lang
    scheme?: 'light' | 'dark'
    context?: { page?: string; topic?: string; locale?: string }
    offsetRight?: string
    offsetBottom?: string
  }): Promise<AssistantInstance>
}

declare global {
  interface Window {
    EuleWidget?: AssistantGlobal
  }
}

// Launcher placement (the widget's offset API; the chat panel tracks these and
// the widget keeps it from overflowing the viewport). Right: aligned with the
// centered content column (SHELL_MAX_WIDTH + the shell's 24px desktop side
// padding), floored at the shell's 16px mobile padding — a single expression,
// so between 768px and the column width the floor is 16px rather than the
// desktop 24px; the 8px difference isn't worth a breakpoint-driven remount.
// Bottom: clears the footer's impressum line (~61px mobile / ~69px desktop).
const OFFSET_RIGHT = `max(16px, calc((100vw - ${SHELL_MAX_WIDTH}px) / 2 + 24px))`
const OFFSET_BOTTOM = '80px'

// The bundle is loaded once per page; concurrent/subsequent mounts await the
// same promise. On failure the promise is cleared so a later mount can retry.
let scriptLoad: Promise<void> | null = null

function loadWidgetScript(src: string): Promise<void> {
  if (window.EuleWidget) return Promise.resolve()
  if (!scriptLoad) {
    scriptLoad = new Promise((resolve, reject) => {
      const el = document.createElement('script')
      el.src = src
      el.async = true
      el.onload = () => resolve()
      el.onerror = () => {
        scriptLoad = null
        el.remove()
        reject(new Error(`assistant widget failed to load: ${src}`))
      }
      document.head.appendChild(el)
    })
  }
  return scriptLoad
}

export function AssistantWidget({
  widgetUrl,
  botId,
  locale,
  isDark,
}: {
  widgetUrl: string
  botId: string
  locale: Lang
  isDark: boolean
}) {
  const scheme = isDark ? 'dark' : 'light'

  useEffect(() => {
    if (!widgetUrl || !botId) return
    let cancelled = false
    let instance: AssistantInstance | null = null

    void (async () => {
      try {
        await loadWidgetScript(widgetUrl)
        if (cancelled || !window.EuleWidget) return
        instance = await window.EuleWidget.mount({
          botId,
          // The widget defaults baseUrl to the page origin; the gateway lives at
          // the widget bundle's origin instead.
          baseUrl: new URL(widgetUrl).origin,
          mode: 'launcher',
          lang: locale,
          scheme,
          // Origin + pathname only — never query/fragment (they can carry
          // personal data). Matches the widget's own "auto" behavior.
          context: { page: window.location.origin + window.location.pathname },
          offsetRight: OFFSET_RIGHT,
          offsetBottom: OFFSET_BOTTOM,
        })
        if (cancelled) instance.dispose()
      } catch (err) {
        // Assistant down or misconfigured: log and stay invisible.
        console.error('[assistant-widget]', err)
      }
    })()

    // Locale/theme changes dispose and remount (the widget has no live setters);
    // it rehydrates its persisted session, so the conversation survives.
    return () => {
      cancelled = true
      instance?.dispose()
    }
  }, [widgetUrl, botId, locale, scheme])

  return null
}
