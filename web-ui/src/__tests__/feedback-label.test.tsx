import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DashboardShell } from '@/components/DashboardShell'
import type { Localized, Me } from '@/lib/api'
import type { Branding } from '@/lib/branding'
import { t, type Lang } from '@/lib/i18n'
import { BRANDING } from '@/test/branding'

// Issue #222: the footer feedback link's *label* joins its target in branding
// config. `branding.feedback_label` is localized — `{de, en}` — because it is a
// UI label, not a proper noun: a deployment that renames the link for its
// ticket system should not hand its German label to an English reader.
//
// The fallback has two layers and they are not the same thing, which is what
// most of this suite is about (the issue's decision table):
//
//   config                          | de reader | en reader
//   --------------------------------|-----------|-------------------------
//   unset / empty                   | built-in  | built-in
//   {de: "Kontakt"}                 | Kontakt   | Kontakt  ← between LANGUAGES
//   {de: "Kontakt", en: "Contact"}  | Kontakt   | Contact
//
// Row 2 is the one worth pinning: localized() falls back to the language that
// *is* filled, which is right for a deployment that translated one of them —
// and is emphatically not "fall back to the built-in English label".
//
// The resolver is the shared one (localized(), lib/api.ts). These tests go
// through the rendered shell rather than calling it directly, so what they
// assert is the label the user reads.

const ME = {
  id: 'u1',
  display_name: 'Alex Beispiel',
  email: 'a@example.edu',
  primary_role: 'student',
  is_admin: false,
  view_mode: 'list',
  theme: 'light',
  locale: 'de',
  favorites_order: 'usage',
  favorites_separate_tab: false,
  show_beta: false,
  visibility: { held: [], entries: [] },
} as unknown as Me

const URL = 'https://tickets.example.edu/new'

function renderShell(locale: Lang, branding: Partial<Branding>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { unmount } = render(
    <QueryClientProvider client={qc}>
      <DashboardShell
        branding={{ ...BRANDING, ...branding }}
        me={ME}
        locale={locale}
        isDark={false}
        theme="light"
        onSetTheme={() => {}}
        onSetLocale={() => {}}
        onAdmin={() => {}}
        isMobile={false}
        showBeta={false}
        onSetShowBeta={() => {}}
        focusKey="dashboard"
      >
        <p>Inhalt</p>
      </DashboardShell>
    </QueryClientProvider>,
  )
  return { unmount }
}

/** The footer's feedback link, found by its href — never by its text, which is
 *  the thing under test. */
function feedbackLink(href = URL): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(`footer a[href="${href}"]`)
}

describe.each<Lang>(['de', 'en'])('the footer feedback label (%s reader)', (locale) => {
  const builtIn = t(locale).footer.feedback

  it('keeps the built-in label when nothing is configured', () => {
    renderShell(locale, { feedback_url: URL })
    expect(feedbackLink()?.textContent).toBe(builtIn)
  })

  it('keeps the built-in label for an empty map', () => {
    // The served default: `feedback_label: {}`. An unconfigured deployment must
    // render exactly today's footer, so empty is a no-op and not an empty link.
    renderShell(locale, { feedback_url: URL, feedback_label: {} })
    expect(feedbackLink()?.textContent).toBe(builtIn)
  })

  it('renders the configured label for its own language', () => {
    renderShell(locale, {
      feedback_url: URL,
      feedback_label: { de: 'Kontakt', en: 'Contact' },
    })
    expect(feedbackLink()?.textContent).toBe(locale === 'de' ? 'Kontakt' : 'Contact')
  })

  it('serves a half-translated label in the language that is filled, not the built-in one', () => {
    // Row 2. An English reader gets "Kontakt" — the deployment renamed the
    // link and translated one language; a built-in "Feedback" next to a German
    // "Kontakt" would be two names for one link.
    renderShell(locale, { feedback_url: URL, feedback_label: { de: 'Kontakt' } })
    expect(feedbackLink()?.textContent).toBe('Kontakt')
    expect(feedbackLink()?.textContent).not.toBe(builtIn)
  })

  it('changes nothing about the link but its text', () => {
    // The label is a label: the href, the new-tab treatment and its rel come
    // from feedbackHref(branding.feedback_url) and must be untouched by it.
    renderShell(locale, { feedback_url: URL, feedback_label: { de: 'Kontakt', en: 'Contact' } })
    const link = feedbackLink()!
    expect(link.getAttribute('href')).toBe(URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('leaves the internal-target branch alone', () => {
    // feedbackHref's other branch: a mailto: opens in place, so it carries no
    // target/rel. Renaming the link must not push it through the external one.
    const mail = 'mailto:it-support@example.edu'
    renderShell(locale, { feedback_url: mail, feedback_label: { de: 'IT-Support' } })
    const link = feedbackLink(mail)!
    expect(link.textContent).toBe('IT-Support')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.getAttribute('rel')).toBeNull()
  })

  it('renders no link at all for a label without a URL', () => {
    // The URL is what gates the link (documented in config.example.yaml), so a
    // label on its own has nothing to name — and must not conjure a link.
    renderShell(locale, { feedback_label: { de: 'Kontakt', en: 'Contact' } })
    expect(screen.queryByRole('contentinfo')).toBeNull()
    expect(screen.queryByText('Kontakt')).toBeNull()
    expect(screen.queryByText('Contact')).toBeNull()
  })
})

describe('an unknown-locale reader', () => {
  it('still gets a configured label rather than nothing', () => {
    // localized()'s last resort: a locale the deployment never named falls
    // through to de, then en, then any value — the label is always *some*
    // real string, never ''. Guards the `|| built-in` at the call site from
    // being read as "any missing exact match means built-in".
    const label: Localized = { fr: 'Contactez-nous' }
    renderShell('de', { feedback_url: URL, feedback_label: label })
    expect(feedbackLink()?.textContent).toBe('Contactez-nous')
  })
})
