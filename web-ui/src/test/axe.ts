import axe from 'axe-core'

// runAxe checks a rendered container for accessibility violations. color-contrast
// is disabled because jsdom does not compute layout/colors; contrast is verified
// in the Playwright e2e pass (docs/04 §3). This still catches ARIA, roles,
// labels, and keyboard-affecting issues.
export async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  })
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join('\n')
    throw new Error(`axe found ${results.violations.length} violation(s):\n${summary}`)
  }
}
