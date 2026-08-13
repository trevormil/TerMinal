import { describe, expect, test } from 'bun:test'
import {
  FOCUSABLE_SELECTOR,
  buttonClasses,
  iconButtonClasses,
  inputClasses,
  join,
  nextFocusIndex,
  selectClasses,
  type ButtonVariant,
  type ControlSize,
} from './controls'

const VARIANTS: ButtonVariant[] = ['primary', 'ghost', 'danger', 'subtle']
const SIZES: ControlSize[] = ['xs', 'sm', 'md']

describe('button variants', () => {
  test('every variant is distinct — a variant that renders as another is a lie', () => {
    const seen = new Set(VARIANTS.map((v) => buttonClasses(v)))
    expect(seen.size).toBe(VARIANTS.length)
  })

  test('every size is distinct and none omits padding', () => {
    const seen = new Set(SIZES.map((s) => buttonClasses('subtle', s)))
    expect(seen.size).toBe(SIZES.length)
    for (const s of SIZES) expect(buttonClasses('subtle', s)).toMatch(/\bpx-[\d.]+ py-[\d.]+\b/)
  })

  test('every variant carries the disabled affordance', () => {
    // A disabled button that still looks clickable is the bug this centralises
    // away: 57 call sites spelled it, and the ones that forgot are why.
    for (const v of VARIANTS) {
      expect(buttonClasses(v), v).toContain('disabled:opacity-40')
      expect(buttonClasses(v), v).toContain('disabled:cursor-default')
      expect(iconButtonClasses(v), v).toContain('disabled:opacity-40')
    }
  })

  test('tints stay on the two steps the design system allows', () => {
    // design-system.md §2.2 — /10 = worth noticing, /20 = active. A third step
    // fails design-system.test.ts, so catch it here where the message is clear.
    const all = [
      ...VARIANTS.map((v) => buttonClasses(v)),
      ...VARIANTS.map((v) => iconButtonClasses(v)),
      inputClasses(),
      selectClasses(),
    ].join(' ')
    const steps = new Set(
      [...all.matchAll(/(?:bg|text)-\[var\(--gt-(?:accent|red|green|yellow|blue)[a-z-]*\)\]\/(\d+)/g)].map(
        (m) => m[1],
      ),
    )
    expect([...steps].sort()).toEqual(['10', '20'])
  })

  test('no raw colour reaches a control', () => {
    const all = VARIANTS.flatMap((v) => [buttonClasses(v), iconButtonClasses(v)]).join(' ')
    expect(all).not.toMatch(/bg-(?:zinc|slate|neutral|gray)-\d/)
    expect(all).not.toMatch(/bg-\[#/)
  })

  test('a caller-supplied className lands last so it can override', () => {
    const cls = buttonClasses('ghost', 'sm', 'w-full')
    expect(cls.endsWith('w-full')).toBe(true)
  })

  test('the icon variant pads square rather than wide', () => {
    expect(iconButtonClasses('ghost', 'sm')).toContain('p-1')
    expect(iconButtonClasses('ghost', 'sm')).not.toMatch(/\bpx-/)
  })
})

describe('fields', () => {
  test('input and select share the field chrome the renderer already used', () => {
    for (const cls of [inputClasses(), selectClasses()]) {
      expect(cls).toContain('bg-black/30')
      expect(cls).toContain('border-[var(--gt-border)]')
      expect(cls).toContain('focus:border-[var(--gt-accent)]/60')
      // `outline-none` without a focus style would leave a keyboard user with
      // no visible focus at all — the two must travel together.
      expect(cls).toContain('outline-none')
    }
  })

  test('select is the field plus a pointer, not a second look', () => {
    expect(selectClasses().replace(' cursor-pointer', '')).toBe(inputClasses())
  })
})

describe('join', () => {
  test('drops falsy parts and collapses whitespace', () => {
    expect(join('a', false, null, undefined, '  b   c ')).toBe('a b c')
  })

  test('returns empty rather than a stray space for nothing', () => {
    expect(join(false, undefined)).toBe('')
  })
})

describe('focus trap arithmetic', () => {
  test('Tab wraps forwards at the end', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0)
    expect(nextFocusIndex(3, 0, false)).toBe(1)
  })

  test('Shift+Tab wraps backwards at the start', () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2)
    expect(nextFocusIndex(3, 2, true)).toBe(1)
  })

  test('focus on the dialog shell enters at the correct end', () => {
    // -1 = focus is on the shell (tabindex=-1) or has escaped the dialog.
    expect(nextFocusIndex(3, -1, false)).toBe(0)
    expect(nextFocusIndex(3, -1, true)).toBe(2)
  })

  test('an empty dialog traps nothing rather than throwing', () => {
    expect(nextFocusIndex(0, -1, false)).toBeNull()
    expect(nextFocusIndex(0, 0, true)).toBeNull()
  })

  test('a single focusable stays put instead of cycling out', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0)
    expect(nextFocusIndex(1, 0, true)).toBe(0)
  })

  test('the selector skips disabled controls and tabindex=-1', () => {
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])')
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
  })
})
