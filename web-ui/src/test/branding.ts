import type { Branding } from '@/lib/branding'

// The one Branding literal the test suite shares (issue #184).
//
// Every field of Branding is runtime config, so a test that only cares about,
// say, the launcher tabs still has to name all of them to satisfy the type.
// Copied per file, that turned every new branding field into a compile error in
// unrelated suites: news_url (#179) broke three at once, and watermark (#174)
// would have broken them the other way round. Adding a field here now fixes
// them all in one place.
//
// The defaults are deliberately inert — empty strings, no theme tokens — so a
// test asserting on a branding-driven element has to opt in by overriding, and
// that override reads as the point of the test:
//
//   render(<Foo branding={{ ...BRANDING, watermark: '/mark.svg' }} />)
export const BRANDING: Branding = {
  product_name: 'wolke',
  org_name: 'Universität Osnabrück',
  logo_light: '',
  logo_dark: '',
  favicon: '',
  watermark: '',
  default_locale: 'de',
  imprint_url: '',
  privacy_url: '',
  feedback_url: '',
  feedback_label: {},
  bot_url: '',
  help_url: '',
  news_url: '',
  assistant_widget_url: '',
  assistant_bot_id: '',
  theme: { light: {}, dark: {} },
  fonts: {},
  // Inert like the rest of this fixture, and deliberately NOT the served
  // default (true): a test that cares about the accented stop opts in, and
  // that override reads as the point of the test. The real default is pinned
  // in Go (internal/config/greeting_accent_test.go) and on the payload.
  greeting_accent: false,
}
