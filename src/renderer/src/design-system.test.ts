import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Ticket 119. The rules in docs/design-system.md, checked.
//
// Documented rules decay — this repo has the receipts. Three test-isolation
// incidents, two divergent `fmtUsd` copies, and a tab strip that drifted until
// it had to be extracted into DetailTabs all happened under documentation that
// already said not to.
//
// Where the codebase does not yet comply, the current count is PINNED rather
// than the rule being weakened. A pinned budget that can only go down converts
// "we should fix this someday" into "you cannot make it worse", which is the
// only version of a cleanup rule that survives contact with a deadline.

const ROOT = resolve(import.meta.dir, '../../..')
const RENDERER = 'src/renderer/src'

function sources(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) walk(abs)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(relative(ROOT, abs))
    }
  }
  walk(join(ROOT, RENDERER))
  return out.sort()
}

const SOURCES = sources()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

test('the scan sees the renderer — a guard matching nothing is not a guard', () => {
  expect(SOURCES.length).toBeGreaterThan(50)
  expect(SOURCES).toContain('src/renderer/src/components/ui.tsx')
})

// ---------------------------------------------------------------------------
// [2] Surfaces
// ---------------------------------------------------------------------------

describe('surfaces (design-system.md §2)', () => {
  /** The only tokens allowed as a background. */
  // `--gt-border` is here because a 1px hairline filled with the border colour
  // is a RULE, not a surface — it has no area to sit things on. Excluding it
  // would have forced a second divider token, which is the proliferation this
  // rule exists to stop.
  const SURFACES = [
    '--gt-bg',
    '--gt-panel',
    '--gt-code-bg',
    '--gt-terminal-bg',
    '--gt-input',
    '--gt-border',
  ]

  test('no background uses a surface token outside the allowlist', () => {
    // --gt-elevated (0 uses), --gt-panel-2 (1) and --gt-surface-hover (1) are
    // vestigial. Naming a third depth is what produced 66 distinct background
    // values from a two-surface design.
    const offenders: string[] = []
    for (const rel of SOURCES) {
      read(rel)
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(/bg-\[var\((--gt-[a-z0-9-]+)\)\]/g)) {
            if (!SURFACES.includes(m[1])) offenders.push(`${rel}:${i + 1} ${m[1]}`)
          }
        })
    }
    // Semantic tints (accent/red/green/yellow) are covered by the opacity rule
    // below, not here — they colour a state, they are not a depth.
    const depth = offenders.filter((o) => !/(accent|red|green|yellow|blue)/.test(o))
    expect(depth).toEqual([])
  })

  test('raw colour backgrounds are not introduced', () => {
    // If a colour is worth using twice it is worth a token; if it is used once
    // it is probably a mistake.
    const offenders: string[] = []
    for (const rel of SOURCES) {
      read(rel)
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(
            /bg-(?:\[#[0-9a-fA-F]{3,8}\]|(?:zinc|slate|neutral|gray)-\d+)/g,
          )) {
            offenders.push(`${rel}:${i + 1} ${m[0]}`)
          }
        })
    }
    // Burned to zero (was pinned at 12). Inactive dots and off-state toggle
    // tracks use the white-overlay idiom (bg-white/10, /20) — a neutral tint
    // over whatever surface is beneath, not a named colour at a fixed depth.
    expect(offenders).toEqual([])
  })

  test('tints use two steps, not five', () => {
    // /10 = worth noticing, /20 = selected. Five accent opacities is not a
    // scale, it is five people each picking one.
    const found = new Set<string>()
    for (const rel of SOURCES) {
      for (const m of read(rel).matchAll(
        /bg-\[var\(--gt-(?:accent|red|green|yellow|blue)[a-z0-9-]*\)\]\/(\d+)/g,
      )) {
        found.add(m[1])
      }
    }
    // AT TARGET: the doc's two steps, {10, 20}. /10 = worth noticing (badges,
    // tags, resting action fills), /20 = selected or hovered. A third step
    // fails the build; the doc says the answer is a border or a weight change.
    expect(found.size).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// [5] Icons
// ---------------------------------------------------------------------------

describe('icons (design-system.md §5)', () => {
  // Pictographs and emoji. Deliberately EXCLUDES arrows, box-drawing and
  // typographic marks — `↑`/`↓` for git ahead/behind and `⌃⇧` for key hints are
  // content, not decoration, and the rule says so.
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2705}\u{274C}\u{2B50}\u{FE0F}]/u

  test('no emoji in renderer source', () => {
    const offenders: string[] = []
    for (const rel of SOURCES) {
      read(rel)
        .split('\n')
        .forEach((line, i) => {
          if (EMOJI.test(line)) offenders.push(`${rel}:${i + 1} ${line.trim().slice(0, 70)}`)
        })
    }
    expect(offenders).toEqual([])
  })

  test('the pattern catches emoji and spares typographic marks', () => {
    // Guards against someone "simplifying" EMOJI into something that flags the
    // git ahead/behind arrows and gets disabled a week later.
    for (const yes of ['⛔ blocked', '✅ done', '🚀 ship', '⚠️ warn']) {
      expect(EMOJI.test(yes), `${yes} should be flagged`).toBe(true)
    }
    for (const no of ['↑2 ↓1', '⌃⇧Tab', 'a · b', '─────', '✕']) {
      expect(EMOJI.test(no), `${no} should be allowed`).toBe(false)
    }
  })

  test('main-process notification bodies are NOT covered', () => {
    // Telegram and push are read in other people's clients, where an icon font
    // does not exist. This scan is renderer-only on purpose.
    expect(SOURCES.every((s) => s.startsWith(RENDERER))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// [7] Components
// ---------------------------------------------------------------------------

describe('components (design-system.md §7)', () => {
  test('the shared library exists and exports the documented set', () => {
    const ui = read('src/renderer/src/components/ui.tsx')
    for (const name of ['Card', 'Stat', 'Row', 'Big', 'Gauge', 'Badge', 'Empty', 'CopyButton']) {
      expect(ui, `ui.tsx should export ${name}`).toContain(`export function ${name}`)
    }
  })

  test('Card does not fill — depth comes from the border', () => {
    // The specific complaint that opened this ticket: a card inside a panel,
    // filled with the panel colour, reads as a third surface. It looks off
    // because it IS off — the same colour at two depths says the hierarchy is
    // decorative.
    const ui = read('src/renderer/src/components/ui.tsx')
    const card = ui.slice(ui.indexOf('export function Card'), ui.indexOf('export function Gauge'))
    expect(card).not.toMatch(/bg-\[var\(--gt-panel\)\]/)
    expect(card).toMatch(/border-\[var\(--gt-border\)\]/)
  })
})

// ---------------------------------------------------------------------------
// The document itself
// ---------------------------------------------------------------------------

describe('the design system is documented', () => {
  const doc = read('docs/design-system.md')

  test('every enforced rule has a section to point at', () => {
    for (const anchor of ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]', '[8]']) {
      expect(doc).toContain(anchor)
    }
  })

  test('it names the enforcement file, so the two cannot drift silently', () => {
    expect(doc).toContain('design-system.test.ts')
  })
})
