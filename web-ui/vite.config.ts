/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// The dev server proxies API/branding/auth to the Go server on :8080, so the
// no-Docker local loop is `go run ./cmd/server` + `npm run dev` (docs/04 §4).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Pinned (strictPort) so the OIDC PUBLIC_URL for the dev loop is
    // deterministic: set PUBLIC_URL=http://localhost:5180 in .env for `make run`.
    // 5173 is avoided because it commonly collides with other local projects.
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/branding': 'http://localhost:8080',
      '/auth': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    // Never inline fonts as data: URIs. The strict CSP (default-src 'self', no
    // font-src) rejects data: fonts; emitting them as files keeps every font
    // same-origin so the CSP stays untouched. Other assets keep the default
    // size-based inlining (return undefined).
    assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? false : undefined),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      // Exclude tests, the entrypoint, and the test harness from the denominator.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
})
