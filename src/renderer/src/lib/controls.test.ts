import { describe, expect, test } from 'bun:test'
import {
  FOCUSABLE_SELECTOR,
  buttonClasses,
  iconButtonClasses,
  inputClasses,
  join,
  mergeClasses,
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
      [
        ...all.matchAll(
          /(?:bg|text)-\[var\(--gt-(?:accent|red|green|yellow|blue)[a-z-]*\)\]\/(\d+)/g,
        ),
      ].map((m) => m[1]),
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

describe('mergeClasses', () => {
  // Why this exists: Tailwind resolves two classes that set the same property
  // by STYLESHEET order, not class-list order. Plain concatenation therefore
  // makes `className` a coin-flip whenever it overrides a base utility, which
  // is exactly what every migrated call site does.
  const has = (out: string, cls: string) => out.split(' ').includes(cls)

  test('a later class evicts the base class it conflicts with', () => {
    const out = mergeClasses('px-2 py-1 text-[11px]', 'text-[13px]')
    expect(has(out, 'text-[13px]')).toBe(true)
    expect(has(out, 'text-[11px]')).toBe(false)
    // Untouched groups survive.
    expect(has(out, 'px-2')).toBe(true)
    expect(has(out, 'py-1')).toBe(true)
  })

  test('a font size does not evict a text colour, or vice versa', () => {
    // Both are `text-*`, but they set different properties. Collapsing them
    // would silently strip the colour off every sized control.
    const out = mergeClasses('text-zinc-200 text-[11px]', 'text-[13px]')
    expect(has(out, 'text-zinc-200')).toBe(true)
    expect(has(out, 'text-[13px]')).toBe(true)

    const colour = mergeClasses('text-zinc-200 text-[11px]', 'text-zinc-500')
    expect(has(colour, 'text-[11px]')).toBe(true)
    expect(has(colour, 'text-zinc-500')).toBe(true)
    expect(has(colour, 'text-zinc-200')).toBe(false)
  })

  test('named sizes and lengths are the same group', () => {
    expect(has(mergeClasses('text-[11px]', 'text-sm'), 'text-[11px]')).toBe(false)
  })

  test('a variant only conflicts with the same variant', () => {
    const out = mergeClasses('bg-black/30 hover:bg-white/5', 'bg-black/20')
    expect(has(out, 'bg-black/20')).toBe(true)
    expect(has(out, 'bg-black/30')).toBe(false)
    // The hover state is a different rule and must survive.
    expect(has(out, 'hover:bg-white/5')).toBe(true)
  })

  test('placeholder and focus variants are scoped, not global', () => {
    const out = mergeClasses(
      'text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60',
      'placeholder:text-zinc-700',
    )
    expect(has(out, 'text-zinc-200')).toBe(true)
    expect(has(out, 'placeholder:text-zinc-700')).toBe(true)
    expect(has(out, 'placeholder:text-zinc-600')).toBe(false)
    expect(has(out, 'focus:border-[var(--gt-accent)]/60')).toBe(true)
  })

  test('border width and border colour are separate groups', () => {
    // Dropping the bare `border` when a colour is set would remove the border.
    const out = mergeClasses('border border-[var(--gt-border)]', 'border-[var(--gt-red)]/50')
    expect(has(out, 'border')).toBe(true)
    expect(has(out, 'border-[var(--gt-red)]/50')).toBe(true)
    expect(has(out, 'border-[var(--gt-border)]')).toBe(false)
  })

  test('padding axes do not evict each other', () => {
    const out = mergeClasses('px-2 py-1', 'px-3')
    expect(has(out, 'py-1')).toBe(true)
    expect(has(out, 'px-3')).toBe(true)
    expect(has(out, 'px-2')).toBe(false)
  })

  test('font family and weight are independent', () => {
    const out = mergeClasses('font-semibold', 'font-mono')
    expect(has(out, 'font-semibold')).toBe(true)
    expect(has(out, 'font-mono')).toBe(true)
  })

  test('an unrecognised utility degrades to concatenation, not to a wrong guess', () => {
    const out = mergeClasses('animate-spin shrink-0', 'tabular-nums')
    expect(out.split(' ').sort()).toEqual(['animate-spin', 'shrink-0', 'tabular-nums'])
  })

  test('an exact duplicate is emitted once', () => {
    expect(mergeClasses('shrink-0', 'shrink-0')).toBe('shrink-0')
  })

  test('empty and falsy parts are dropped without leaving blanks', () => {
    expect(mergeClasses('px-2', false, null, undefined, '')).toBe('px-2')
  })
})
