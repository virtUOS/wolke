import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ApiError } from './lib/api'
// Self-hosted fonts (bundled by Vite) — no external requests to Google, so the
// strict CSP holds and there's no GDPR/privacy concern. Variable-weight files;
// Newsreader's optical-size axis backs `font-optical-sizing: auto`.
import '@fontsource-variable/hanken-grotesk/wght.css'
import '@fontsource-variable/newsreader/opsz.css'
import './index.css'
import { initInstallCapture } from './lib/pwa-install'

// The service worker is registered by <UpdateNotice> (components/UpdateNotice)
// via useRegisterSW, not here: registration is now in *prompt* mode, so whoever
// registers must also own the "new version available" state (issue #42). It is
// bundled, never an inline script, so script-src 'self' holds.

// Capture the install prompt from startup — the event can fire before React
// mounts, and a missed event means no install hint (issue #42).
initInstallCapture()

// TanStack Query is the convention for all server state (CLAUDE.md). Don't retry
// 4xx responses (a 401 means "log in", not "try again") — only retry transient
// failures, and only a couple of times.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      // Catalog/me/branding are stable across a session; treat data as fresh for
      // 30s so navigating tabs or refocusing the window doesn't refetch on every
      // mount. Writes still invalidate explicitly (see admin-hooks).
      staleTime: 30_000,
    },
  },
})

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
