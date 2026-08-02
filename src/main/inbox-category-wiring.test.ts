import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deriveCategories, normalizeCategory } from '../shared/inbox-categories'

// Ticket 120. The derivation logic is unit-tested next to itself; this file
// checks the thing that actually makes the feature real — that `category`
// survives the whole path.
//
// There are FIVE writers of hitl.json (ticket 110). A field that only one of
// them carries is a field the Inbox shows inconsistently depending on which
// process filed the item, which is worse than not having it.

const ROOT = resolve(import.meta.dir, '../..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

describe('category survives every writer (ticket 120)', () => {
  test('the main-process type declares it', () => {
    expect(read('src/main/hitl.ts')).toMatch(/category\?: string/)
  })

  test('fileHitl normalizes at the write boundary, not at read time', () => {
    // Normalizing once, where the item is created, is what lets every reader
    // trust the field without re-checking it.
    const hitl = read('src/main/hitl.ts')
    expect(hitl).toContain('normalizeCategory(input.category)')
  })

  test('the renderer type mirrors it', () => {
    // main → preload → renderer must agree, or the field is invisible in the UI
    // while being present on disk.
    expect(read('src/renderer/src/lib/types.ts')).toMatch(/category\?: string/)
  })

  test('bin/terminal-cli accepts --category and puts it on the item', () => {
    const cli = read('bin/terminal-cli')
    expect(cli).toContain('normalizeCategoryShared(opts.category)')
    // Computing it and forgetting to spread it is exactly the half-wiring that
    // lint caught here once already.
    expect(cli).toContain('...(category ? { category } : {})')
  })

  test('bin/terminal-mcp-server accepts it too', () => {
    const mcp = read('bin/terminal-mcp-server')
    expect(mcp).toMatch(/severity,\s*category\s*\}/)
    expect(mcp).toContain('normalizeCategoryShared(category)')
  })

  test('both bin scripts inline the normalizer, since they cannot import it', () => {
    // Same constraint as the file-lock helper: standalone scripts copied to
    // remote hosts with no sibling modules.
    for (const f of ['bin/terminal-cli', 'bin/terminal-mcp-server']) {
      expect(read(f), `${f} should inline it`).toContain('function normalizeCategoryShared')
    }
  })

  test('the inlined copies agree with the canonical one', () => {
    // Extracted and RUN, not eyeballed — a copy that has drifted is the whole
    // risk of inlining.
    const cli = read('bin/terminal-cli')
    const start = cli.indexOf('function normalizeCategoryShared')
    const body = cli.slice(start, cli.indexOf('\n}\n', start) + 3)
    const mirrored = new Function(`${body}; return normalizeCategoryShared`)() as (
      v: unknown,
    ) => string | undefined
    for (const input of ['Monitoring', '  spaced  ', '', 'x'.repeat(80), 'a\nb', 42, null]) {
      expect(mirrored(input)).toEqual(normalizeCategory(input))
    }
  })
})

describe('a real caller exists (ticket 120)', () => {
  test('the monitor-liveness escalation files under Monitoring', () => {
    // A feature whose only user is its own test is a feature nobody has run.
    expect(read('src/main/monitor-liveness-runtime.ts')).toContain("category: 'Monitoring'")
  })

  test('naming a category required no registration anywhere', () => {
    // The point of the whole ticket. If a registry ever appears, this fails.
    const forbidden = /(CATEGORY_LIST|KNOWN_CATEGORIES|CategoryId|categories:\s*\[)/
    for (const f of [
      'src/shared/inbox-categories.ts',
      'src/main/hitl.ts',
      'src/renderer/src/tabs/hitl/index.tsx',
    ]) {
      expect(read(f), `${f} must not declare a fixed category list`).not.toMatch(forbidden)
    }
  })

  test('an unheard-of category flows through derivation untouched', () => {
    // End to end at the data level: the string a caller passes is the string
    // the sidebar groups by.
    const cats = deriveCategories([{ category: 'Quarterly Board Review' }])
    expect(cats.map((c) => c.name)).toContain('Quarterly Board Review')
  })
})

describe('the sidebar is built on the design system (ticket 119)', () => {
  const tab = read('src/renderer/src/tabs/hitl/index.tsx')

  test('it uses an allowed surface, not a new one', () => {
    const aside = tab.slice(tab.indexOf('<aside'), tab.indexOf('</aside>'))
    expect(aside).toContain('bg-[var(--gt-panel)]')
    expect(aside).not.toMatch(/bg-\[var\(--gt-(elevated|panel-2|surface-hover)\)\]/)
  })

  test('the active row uses the /20 active tint', () => {
    const aside = tab.slice(tab.indexOf('<aside'), tab.indexOf('</aside>'))
    expect(aside).toContain('bg-[var(--gt-accent)]/20')
  })

  test('category labels are capitalized', () => {
    // ALL and UNCATEGORIZED are the two the app itself supplies.
    expect(normalizeCategory('Monitoring')).toBe('Monitoring')
    const cats = deriveCategories([{}])
    for (const c of cats) expect(c.name[0]).toBe(c.name[0].toUpperCase())
  })
})
