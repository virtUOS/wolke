import axe from 'axe-core'

// runAxe checks a rendered container for accessibility violations. color-contrast
// is disabled because jsdom does not compute layout/colors; contrast is verified
// in the Playwright e2e pass (docs/04 §3). This still catches ARIA, roles,
// labels, and keyboard-affecting issues.
//
// `disabledRules` additionally turns off page-level best-practice rules (e.g.
// `region`, which asserts all content sits in a landmark) that only make sense
// for a full document — not when auditing an isolated component in jsdom.
export async function expectNoAxeViolations(container: HTMLElement, disabledRules: string[] = []): Promise<void> {
  const rules: Record<string, { enabled: false }> = { 'color-contrast': { enabled: false } }
  for (const id of disabledRules) rules[id] = { enabled: false }
  const results = await axe.run(container, { rules })
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`)
      .join('\n')
    throw new Error(`axe found ${results.violations.length} violation(s):\n${summary}`)
  }
}
