import { resolveInstallHint } from '@/lib/pwa-install'

describe('resolveInstallHint', () => {
  const base = { installable: false, ios: false, standalone: false, dismissed: false }

  it('hides by default (no signal)', () => {
    expect(resolveInstallHint(base)).toBe('hidden')
  })

  it('shows the actionable variant when the install prompt was captured', () => {
    expect(resolveInstallHint({ ...base, installable: true })).toBe('installable')
  })

  it('shows the instruction variant on iOS (no prompt event there)', () => {
    expect(resolveInstallHint({ ...base, ios: true })).toBe('ios')
  })

  it('prefers the actionable variant if both signals are present', () => {
    expect(resolveInstallHint({ ...base, installable: true, ios: true })).toBe('installable')
  })

  it('never shows once dismissed', () => {
    expect(resolveInstallHint({ ...base, installable: true, dismissed: true })).toBe('hidden')
    expect(resolveInstallHint({ ...base, ios: true, dismissed: true })).toBe('hidden')
  })

  it('never shows when already running standalone (installed)', () => {
    expect(resolveInstallHint({ ...base, installable: true, standalone: true })).toBe('hidden')
    expect(resolveInstallHint({ ...base, ios: true, standalone: true })).toBe('hidden')
  })
})
