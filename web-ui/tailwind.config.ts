import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

// Colors resolve to CSS variables (stable names, docs/03 §2) so the runtime
// branding payload re-skins the app without a rebuild. Only values change.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        text: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
        },
        accent: 'var(--accent)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
        },
      },
    },
  },
  plugins: [animate],
} satisfies Config
