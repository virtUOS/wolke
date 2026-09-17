import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// react-refresh/only-export-components fires when a module exports both a
// component and something else: Fast Refresh then falls back to a full reload
// for that module in dev. We keep the rule on — it catches the genuine case, a
// helper that grew inside a feature component and should have moved to lib/ —
// and allow it BY NAME AND BY FILE only where the mixed export is the
// deliberate, documented shape. A new non-component export, here or anywhere
// else, still warns.
//
// `allowConstantExport` already covers a literal constant; it does not cover an
// object or a call result, which is why some plain constants are named below.

// The cva variants each primitive exports alongside itself. That is rule 2 of
// components/ui/README.md ("the cva + cn pattern") and shadcn's own layout:
// callers style a non-primitive element with a primitive's classes (an <a> that
// has to look like an icon button, say). Splitting each into a sibling module
// would buy Fast Refresh on leaf presentational files that hold no state to
// lose, at the price of doubling the file count of the set.
const uiVariantExports = [
  'alertVariants',
  'badgeVariants',
  'buttonVariants',
  'cardVariants',
  'choiceChipVariants',
  'iconButtonVariants',
  'pillButtonVariants',
]

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '*.config.js', '*.config.ts'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: uiVariantExports },
      ],
    },
  },
  {
    // The hook owning the global-search keyboard shortcuts. It belongs with the
    // component it drives: it exists to be called by whoever renders
    // <GlobalSearch/> (Dashboard), and it lives and dies with that markup.
    files: ['src/components/GlobalSearch.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['useSearchHotkeys'] },
      ],
    },
  },
  {
    // The measured watermark numbers. They are exported so the unit tests can
    // assert the rendered geometry against the same source the component
    // renders from, instead of restating those magic numbers in the test.
    files: ['src/components/Watermark.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['WATERMARK_OPACITY', 'WATERMARK_GEOMETRY'] },
      ],
    },
  },
  {
    // The curated icon list the admin icon picker offers, beside the component
    // that renders one of them. Both read the same curated map; separating them
    // would split one small module in two for no gain.
    files: ['src/lib/icons.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['curatedIconNames'] },
      ],
    },
  },
  {
    // The link parser and its plain-text projection, beside <LinkedText/>.
    // Accepted when rich-text.tsx landed (#168): the parser and the renderer of
    // its output are one unit, and NotificationBell needs plainText without the
    // markup. The file is .tsx only because LinkedText renders JSX.
    files: ['src/lib/rich-text.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['parseLinks', 'plainText'] },
      ],
    },
  },
)
