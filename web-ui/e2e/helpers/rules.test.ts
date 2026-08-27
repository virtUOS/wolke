// Unit coverage for the viewport verdict logic. This runs under Vitest (it is a
// .test.ts, not a .spec.ts, and Playwright only picks up *.spec.ts) — the rules
// are plain functions precisely so their edge cases don't need a browser.

import { describe, expect, it } from 'vitest'
import {
  MIN_FONT_SIZE,
  MIN_TOUCH_TARGET,
  describe as describeProbe,
  isScrollContainer,
  overflowKind,
  overflowMessage,
  textNotRendered,
  textTooSmall,
  touchTargetMessage,
  touchTargetTooSmall,
  violationBlock,
  type ElementProbe,
  type Rect,
} from './rules'

function rect(left: number, width: number, height = 20): Rect {
  return { left, right: left + width, top: 0, bottom: height, width, height }
}

function probe(over: Partial<ElementProbe> = {}): ElementProbe {
  const box = over.rect ?? rect(0, 100)
  return {
    selector: 'div.tile',
    text: 'Netzlaufwerkverbindungsverwaltung',
    rect: box,
    fontSize: 14,
    scrollWidth: Math.round(box.width),
    clientWidth: Math.round(box.width),
    overflowX: 'visible',
    textOverflow: 'clip',
    position: 'static',
    hasDirectText: true,
    interactive: false,
    hitRect: box,
    smallTargetOk: false,
    ...over,
  }
}

describe('overflowKind', () => {
  it('passes an element that fits', () => {
    expect(overflowKind(probe({ rect: rect(0, 324) }), 324)).toBeNull()
  })

  it('allows a pixel of subpixel slack at either edge', () => {
    expect(overflowKind(probe({ rect: rect(0, 324.5) }), 324)).toBeNull()
    expect(overflowKind(probe({ rect: rect(-0.5, 324) }), 324)).toBeNull()
  })

  it('reports an element sticking past the right edge', () => {
    expect(overflowKind(probe({ rect: rect(0, 364) }), 324)).toBe('outside-viewport')
  })

  it('reports an element pushed off the left edge', () => {
    // The notification panel anchored to a right-hand trigger on a narrow phone.
    expect(overflowKind(probe({ rect: rect(-12, 358) }), 390)).toBe('outside-viewport')
  })

  it('ignores a zero-area element outside the viewport', () => {
    // Collapsed wrappers and measuring nodes are not a layout defect.
    expect(overflowKind(probe({ rect: { ...rect(400, 0, 0) } }), 324)).toBeNull()
  })

  it('reports content wider than its box', () => {
    expect(overflowKind(probe({ scrollWidth: 149, clientWidth: 134 }), 324)).toBe('clipped-content')
  })

  it('exempts a sanctioned scroll container from its own inner overflow', () => {
    expect(overflowKind(probe({ scrollWidth: 900, clientWidth: 324, overflowX: 'auto' }), 324)).toBeNull()
    expect(overflowKind(probe({ scrollWidth: 900, clientWidth: 324, overflowX: 'scroll' }), 324)).toBeNull()
  })

  it('still holds a scroll container to fitting the viewport itself', () => {
    expect(
      overflowKind(probe({ rect: rect(0, 400), scrollWidth: 900, clientWidth: 400, overflowX: 'auto' }), 324),
    ).toBe('outside-viewport')
  })

  it('exempts truncation that is spelled out with an ellipsis', () => {
    expect(overflowKind(probe({ scrollWidth: 200, clientWidth: 100, textOverflow: 'ellipsis' }), 324)).toBeNull()
  })
})

describe('isScrollContainer', () => {
  it('accepts only auto and scroll', () => {
    expect(isScrollContainer('auto')).toBe(true)
    expect(isScrollContainer('scroll')).toBe(true)
    expect(isScrollContainer('visible')).toBe(false)
    expect(isScrollContainer('hidden')).toBe(false)
    expect(isScrollContainer('clip')).toBe(false)
  })
})

describe('readability', () => {
  it('accepts text exactly at the floor', () => {
    expect(textTooSmall(probe({ fontSize: MIN_FONT_SIZE }))).toBe(false)
  })

  it('rejects text below the floor', () => {
    expect(textTooSmall(probe({ fontSize: 11.5 }))).toBe(true)
  })

  it('ignores elements that hold no text of their own', () => {
    expect(textTooSmall(probe({ fontSize: 8, hasDirectText: false }))).toBe(false)
  })

  it('rejects text collapsed to no height', () => {
    expect(textNotRendered(probe({ rect: rect(0, 100, 0) }))).toBe(true)
  })
})

describe('touchTargetTooSmall', () => {
  it('ignores non-interactive elements', () => {
    expect(touchTargetTooSmall(probe({ hitRect: rect(0, 20, 20) }))).toBe(false)
  })

  it('rejects an undersized control', () => {
    expect(touchTargetTooSmall(probe({ interactive: true, hitRect: rect(0, 26, 26) }))).toBe(true)
  })

  it('accepts a control exactly at the floor', () => {
    expect(touchTargetTooSmall(probe({ interactive: true, hitRect: rect(0, MIN_TOUCH_TARGET, MIN_TOUCH_TARGET) }))).toBe(
      false,
    )
  })

  it('rejects a control that is wide but too short', () => {
    expect(touchTargetTooSmall(probe({ interactive: true, hitRect: rect(0, 200, 20) }))).toBe(true)
  })

  it('honours the reviewed-exception attribute', () => {
    expect(touchTargetTooSmall(probe({ interactive: true, hitRect: rect(0, 20, 20), smallTargetOk: true }))).toBe(false)
  })
})

describe('messages', () => {
  it('names the element, its box and the viewport', () => {
    const msg = overflowMessage(probe({ rect: rect(0, 364) }), 'outside-viewport', 324)
    expect(msg).toContain('div.tile')
    expect(msg).toContain('Netzlaufwerkverbindungsverwaltung')
    expect(msg).toContain('364')
    expect(msg).toContain('324')
  })

  it('explains why clipped content is a failure', () => {
    const msg = overflowMessage(probe({ scrollWidth: 149, clientWidth: 134 }), 'clipped-content', 324)
    expect(msg).toContain('149')
    expect(msg).toContain('134')
    expect(msg).toContain('overflow-x: visible')
  })

  it('points at the allowlist attribute for touch targets', () => {
    expect(touchTargetMessage(probe({ hitRect: rect(0, 26, 26) }))).toContain('data-e2e-small-target-ok')
  })

  it('falls back to the selector when an element has no text', () => {
    expect(describeProbe(probe({ text: '' }))).toBe('div.tile')
  })

  it('renders a violation list as an indented block', () => {
    expect(violationBlock('overflow', ['a', 'b'])).toBe('overflow (2):\n  • a\n  • b')
  })
})
