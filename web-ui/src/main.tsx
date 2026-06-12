import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

// TanStack Query is the convention for all server state (CLAUDE.md). It is wired
// here in Phase 0 even though the only data so far is branding; catalog/favorites
// queries hang off this client in later phases.
const queryClient = new QueryClient()

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
