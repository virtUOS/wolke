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
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
        },
        border: 'var(--border)',
        text: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
        },
        accent: 'var(--accent)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
        },
        info: 'var(--info)',
        warning: 'var(--warning)',
        success: 'var(--success)',
        danger: 'var(--danger)',
      },
      borderRadius: {
        // Tie the corner scale to tokens. Values match Tailwind's md/lg, so
        // existing rounded-md/lg usage is unchanged; aligning the full type
        // scale (docs/03 §3) is deferred — it resizes rendered text and needs a
        // visual pass, not a token-only change.
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
    },
  },
  plugins: [animate],
} satisfies Config
