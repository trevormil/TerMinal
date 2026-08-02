import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Ticket 121. The phone is the same product, and `ios/.../Design/Theme.swift`
// says so in a comment:
//
//   "if the desktop palette changes, change it here too rather than eyeballing
//    something close."
//
// Right intent, no enforcement. That is the same shape as the two divergent
// `fmtUsd` copies and the tab strip that drifted until it had to be extracted —
// a comment asking people to remember.
//
// Lives in the Bun suite rather than XCTest on purpose: it runs on every
// `bun test` and in CI, with no Xcode, and the claim it checks is inherently
// cross-platform. A drift that only Xcode can see is a drift nobody sees.

const ROOT = resolve(import.meta.dir, '../..')
const CSS = 'src/renderer/src/index.css'
const THEME = 'ios/TerMinalRemote/Design/Theme.swift'
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

/** Every .swift file under the app target, repo-relative. */
function swiftFiles(dir = join(ROOT, 'ios/TerMinalRemote')): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...swiftFiles(p))
    else if (e.name.endsWith('.swift')) out.push(relative(ROOT, p))
  }
  return out
}

/** `--gt-accent: #7c6ef6;` → { 'accent': '7c6ef6' }. Hex tokens only. */
function desktopTokens(): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of read(CSS).matchAll(/--gt-([a-z0-9-]+):\s*#([0-9a-fA-F]{6})\b/g)) {
    out.set(m[1], m[2].toLowerCase())
  }
  return out
}

/** `static let accent = Color(hex: 0x7C6EF6)` → { 'accent': '7c6ef6' }. */
function mobileTokens(): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of read(THEME).matchAll(/static let (\w+) = Color\(hex: 0x([0-9a-fA-F]{6})\)/g)) {
    out.set(m[1], m[2].toLowerCase())
  }
  return out
}

/**
 * Swift camelCase ↔ CSS kebab-case. Only the names that genuinely differ; the
 * rest map by lowercasing.
 */
const ALIASES: Record<string, string> = {
  panel2: 'panel-2',
  surfaceHover: 'surface-hover',
  terminalBg: 'terminal-bg',
  codeBg: 'code-bg',
  borderStrong: 'border-strong',
  textSoft: 'text-soft',
  textMuted: 'text-muted',
  textMutedBright: 'text-muted-bright',
  textFaint: 'text-faint',
  accentLight: 'accent-light',
  accent2: 'accent-2',
}

const cssNameFor = (swift: string): string => ALIASES[swift] ?? swift.toLowerCase()

describe('the phone uses the desktop palette (ticket 121)', () => {
  const desktop = desktopTokens()
  const mobile = mobileTokens()

  test('both files parse — a guard that reads nothing is not a guard', () => {
    expect(desktop.size).toBeGreaterThan(15)
    expect(mobile.size).toBeGreaterThan(15)
    expect(desktop.get('accent')).toBe('7c6ef6')
    expect(mobile.get('accent')).toBe('7c6ef6')
  })

  test('every mobile token matches its desktop value exactly', () => {
    // "Eyeballing something close" is the failure this exists to stop: two
    // palettes that look the same in isolation and obviously different when a
    // user has both open.
    const drift: string[] = []
    for (const [swift, hex] of mobile) {
      const css = cssNameFor(swift)
      const want = desktop.get(css)
      if (want === undefined) continue // covered by the next test
      if (want !== hex) drift.push(`${swift} (--gt-${css}): mobile #${hex} vs desktop #${want}`)
    }
    expect(drift).toEqual([])
  })

  test('every mobile token corresponds to a real desktop token', () => {
    // A mobile-only colour is a second palette forming. If one is genuinely
    // needed, it belongs in index.css first so both platforms share it.
    const orphans = [...mobile.keys()]
      .map((s) => ({ swift: s, css: cssNameFor(s) }))
      .filter(({ css }) => !desktop.has(css))
      .map(({ swift, css }) => `${swift} → --gt-${css} (not in index.css)`)
    expect(orphans).toEqual([])
  })

  test('the aliases actually resolve — a stale one would silently skip a token', () => {
    // The subtle failure: rename a token in the CSS, and every alias pointing
    // at the old name starts returning undefined, which the parity test above
    // treats as "not applicable" and passes.
    for (const css of Object.values(ALIASES)) {
      expect(desktop.has(css), `alias target --gt-${css} no longer exists`).toBe(true)
    }
  })
})

describe('the mobile brand surface is deliberate (ticket 121)', () => {
  const theme = read(THEME)

  test('it still points at the desktop as the source of truth', () => {
    // If someone removes this comment, they have decided the phone is its own
    // product. That should be a conversation, not a silent edit.
    expect(theme).toMatch(/index\.css/)
  })

  test('no raw SwiftUI system colour stands in for a brand one', () => {
    // Apple's `.red` is #FF3B30; TerMinal's is #F87171. Reaching for the system
    // colour is not a style preference, it is measurably the wrong colour — and
    // Apple's shift between iOS releases and colour schemes while ours do not.
    //
    // The leading-character class is load-bearing: a naive /\.red\b/ also
    // matches the `.red` inside `GT.red`, which reports ~50 violations where
    // there is really one. A guard that cannot tell the fix from the bug is
    // worse than no guard.
    const RAW = /(?:^|[^A-Za-z0-9_.)\]])\.(?:red|green|blue|yellow|orange|purple|pink)\b/
    const offenders: string[] = []
    for (const rel of swiftFiles()) {
      if (rel.endsWith('Design/Theme.swift')) continue // where the brand colours are defined
      read(rel)
        .split('\n')
        .forEach((line, i) => {
          if (RAW.test(line)) offenders.push(`${rel}:${i + 1} — ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })
})

describe('the design-system rules apply to the phone (ticket 121)', () => {
  // docs/design-system.md §9. The desktop half of these is enforced by
  // src/renderer/src/design-system.test.ts; this is the mobile half. Both exist
  // because this repo has the evidence that a documented-only rule decays —
  // the three test-isolation incidents, the two fmtUsd copies, and the drifted
  // tab strip all happened under documentation that already said not to.

  /** SF Symbol names are data (`envelope.open`), not labels — §9.3. */
  const SYMBOL_ARG = /(?:systemImage|systemName):\s*"/

  test('no emoji in mobile UI strings — SF Symbols is the phone\'s lucide', () => {
    // Deliberately does not match arrows or box-drawing: those are typographic
    // marks, which §5 exempts, and the desktop guard exempts them too.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2700}-\u{27BF}\u{FE0F}]/u
    const offenders: string[] = []
    for (const rel of swiftFiles()) {
      read(rel)
        .split('\n')
        .forEach((line, i) => {
          if (EMOJI.test(line)) offenders.push(`${rel}:${i + 1} — ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })

  test('every user-facing label starts with a capital', () => {
    // §4, unchanged on mobile. Only inspects literals in the label position of
    // Text/Button/Label — an interpolated or variable string is data whose case
    // is the system's to decide, and forcing it would be a lie about the value.
    const LOWER_LABEL = /\b(?:Text|Button|Label)\(\s*"([a-z][^"]*)"/g
    const offenders: string[] = []
    for (const rel of swiftFiles()) {
      read(rel)
        .split('\n')
        .forEach((line, i) => {
          if (SYMBOL_ARG.test(line)) return
          for (const m of line.matchAll(LOWER_LABEL)) {
            offenders.push(`${rel}:${i + 1} — "${m[1]}"`)
          }
        })
    }
    expect(offenders).toEqual([])
  })

  test('surfaceHover is absent — touch has no hover state', () => {
    // §9.2. The token could only ever be dead here, and a dead token is an
    // invitation to invent a use for it.
    const theme = read(THEME)
    expect(theme).not.toMatch(/static let surfaceHover/)
    expect(theme).not.toMatch(/static let elevated/)
  })

  test('panel2 is still here — it has real uses, unlike on desktop', () => {
    // The trap §9.2 exists to stop: someone reads that desktop dropped these as
    // vestigial and sweeps the phone to match, taking the chat bubbles and the
    // lock screen with it. A count on one platform says nothing about the other.
    expect(read(THEME)).toMatch(/static let panel2/)
    const uses = swiftFiles()
      .filter((f) => !f.endsWith('Design/Theme.swift'))
      .reduce((n, f) => n + (read(f).match(/GT\.panel2\b/g) ?? []).length, 0)
    expect(uses).toBeGreaterThan(1)
  })
})
