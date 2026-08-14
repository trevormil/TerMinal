import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deriveCategories, normalizeCategory } from '../shared/inbox-categories'
import { normalizeCategoryShared } from '../cli/hitl'
import type { HitlItem as MainHitlItem } from './hitl'
import type { HitlItem as RendererHitlItem } from '../renderer/src/lib/types'

// Ticket 120. The derivation logic is unit-tested next to itself; this file
// checks the thing that actually makes the feature real — that `category`
// survives the whole path.
//
// There are FIVE writers of hitl.json (ticket 110). A field that only one of
// them carries is a field the Inbox shows inconsistently depending on which
// process filed the item, which is worse than not having it.

const ROOT = resolve(import.meta.dir, '../..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

// Type-level, not text-level: `true` only assigns if the name main exports and
// the name the renderer exports are mutually assignable. Re-forking `HitlItem`
// on either side makes this line a tsc error.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const rendererMirrorsMain: Exact<MainHitlItem, RendererHitlItem> = true

describe('category survives every writer (ticket 120)', () => {
  test('the type declares it, once', () => {
    // `HitlItem` used to be written out twice — in src/main/hitl.ts and again in
    // the renderer's lib/types.ts — and this file had to assert the field on
    // both. It now has ONE declaration in src/shared/types, which is why the
    // "renderer mirrors it" test below is an identity check rather than a grep.
    expect(read('src/shared/types/activity.ts')).toMatch(/category\?: string/)
    expect(read('src/main/hitl.ts')).toContain("from '../shared/types/activity'")
  })

  test('fileHitl normalizes at the write boundary, not at read time', () => {
    // Normalizing once, where the item is created, is what lets every reader
    // trust the field without re-checking it.
    const hitl = read('src/main/hitl.ts')
    expect(hitl).toContain('normalizeCategory(input.category)')
  })

  test('the renderer type mirrors it', () => {
    // main → preload → renderer must agree, or the field is invisible in the UI
    // while being present on disk. This is now enforced by the compile-time
    // identity assertion at the top of this file, which `bunx tsc --noEmit`
    // fails on if the two names ever stop resolving to the same declaration.
    // A grep for the field would pass again the day someone re-forks the type.
    expect(rendererMirrorsMain).toBe(true)
  })

  test('terminal-cli accepts --category and puts it on the item', () => {
    // Read from the typed source: bin/terminal-cli is a build artifact of it.
    const cli = read('src/cli/hitl.ts') + read('src/cli/index.ts')
    expect(cli).toContain('normalizeCategoryShared(opts.category)')
    // Computing it and forgetting to spread it is exactly the half-wiring that
    // lint caught here once already.
    expect(cli).toContain('...(category ? { category } : {})')
    // ...and the DISPATCH must pass it, which the two checks above cannot see.
    // The flag shipped documented-but-dead because this assertion was missing:
    // fileHitl read `opts.category` and the `hitl` case never set it.
    const dispatch = cli.slice(cli.indexOf("case 'hitl':"), cli.indexOf("case 'monitor':"))
    expect(dispatch).toContain('--category=')
    expect(dispatch).toMatch(/category: flag\('category'\)/)
  })

  test('the documented flags are the flags that are parsed', () => {
    // A flag in --help that the parser ignores is worse than an undocumented
    // one: it fails silently and looks like the feature is broken.
    const cli = read('src/cli/index.ts')
    const help = cli.slice(0, cli.indexOf('import '))
    const dispatch = cli.slice(cli.indexOf("case 'hitl':"), cli.indexOf("case 'monitor':"))
    for (const m of help.matchAll(/\[--(\w+)=/g)) {
      expect(dispatch, `--${m[1]} is documented but not parsed`).toContain(`--${m[1]}=`)
    }
  })

  test('bin/terminal-mcp-server accepts it too', () => {
    const mcp = read('bin/terminal-mcp-server')
    expect(mcp).toMatch(/severity,\s*category\s*\}/)
    expect(mcp).toContain('normalizeCategoryShared(category)')
  })

  test('the MCP server still inlines the normalizer, since it cannot import it', () => {
    // Same constraint as the file-lock helper: a standalone script copied to
    // remote hosts with no sibling modules. terminal-cli no longer needs one —
    // it is bundled from src/cli, so its copy is a real module.
    expect(read('bin/terminal-mcp-server')).toContain('function normalizeCategoryShared')
    expect(read('src/cli/hitl.ts')).toContain('export function normalizeCategoryShared')
  })

  test('the copies agree with the canonical one', () => {
    // RUN, not eyeballed — a copy that has drifted is the whole risk of copying.
    const mcp = read('bin/terminal-mcp-server')
    const start = mcp.indexOf('function normalizeCategoryShared')
    const body = mcp.slice(start, mcp.indexOf('\n}\n', start) + 3)
    const mirrored = new Function(`${body}; return normalizeCategoryShared`)() as (
      v: unknown,
    ) => string | undefined
    for (const input of ['Monitoring', '  spaced  ', '', 'x'.repeat(80), 'a\nb', 42, null]) {
      expect(mirrored(input)).toEqual(normalizeCategory(input))
      expect(normalizeCategoryShared(input)).toEqual(normalizeCategory(input))
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
    // The RULE is the allowlist, not one specific token — pinning `--gt-panel`
    // here made a legitimate "make it darker" change look like a violation.
    const aside = tab.slice(tab.indexOf('<aside'), tab.indexOf('</aside>'))
    expect(aside).toMatch(/bg-\[var\(--gt-(bg|panel)\)\]/)
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

describe('bulk actions mean what the visible list says (ticket 120)', () => {
  const tab = read('src/renderer/src/tabs/hitl/index.tsx')

  test('mark-all-read operates on the FILTERED set, not the whole inbox', () => {
    // The bug: filter to Monitoring, hit "Mark all read", and the unread state
    // on every other category is silently gone. A bulk action has to mean the
    // same thing as the list in front of it.
    const fn = tab.slice(tab.indexOf('const markAllRead'), tab.indexOf('const remove ='))
    expect(fn).toContain('scopedUnread')
    // The whole-inbox IPC is only correct when nothing is filtered.
    expect(fn).toMatch(/activeCategory === ALL\s*\?\s*window\.gt\.inbox\.markAllRead\(\)/)
  })

  test('the scoped set is derived from `shown`, which is the rendered list', () => {
    expect(tab).toContain('const scopedUnread = shown.filter(isUnread)')
  })

  test('the button names its scope', () => {
    // "Mark all read" under a filter is a promise the button no longer keeps.
    expect(tab).toMatch(
      /activeCategory === ALL \? 'Mark all read' : `Mark \$\{activeCategory\} read`/,
    )
  })

  test('the unread BADGE still counts the whole inbox', () => {
    // Deliberately different from the button. The badge answers "how much is
    // left?", which a filter must not change; the button answers "what will
    // this do?", which a filter must.
    expect(tab).toContain('const unread = unsnoozed.filter(isUnread)')
  })
})

describe('a row says which category it is in, when that is not obvious (ticket 0123)', () => {
  const tab = read('src/renderer/src/tabs/hitl/index.tsx')
  const row = tab.slice(tab.indexOf('{shown.map((h) => {'), tab.indexOf('{snoozedItems.length > 0'))

  test('the chip is rendered from the item, not from a lookup table', () => {
    // Same derived-not-declared rule as the sidebar: a brand-new category must
    // render without anyone adding it to a map of labels or colours.
    expect(row).toContain('<CategoryChip')
    const chip = tab.slice(
      tab.indexOf('function CategoryChip'),
      tab.indexOf('export type InboxTerminalRef'),
    )
    expect(chip).toContain('categoryLeaf(')
    expect(chip).not.toMatch(/(CATEGORY_LIST|KNOWN_CATEGORIES|Record<string, )/)
  })

  test('it is suppressed when the active filter already says it', () => {
    // Under "Monitoring", stamping "Monitoring" on all twelve rows is noise —
    // the chip only earns its width where the row's folder is not implied.
    expect(row).toContain('activeCategory')
    expect(row).toMatch(/chipCategory\(h,\s*activeCategory\)/)
  })

  test('the rule itself lives in the shared module, where it is unit-tested', () => {
    // Deciding what to stamp is pure logic about categories, so it sits beside
    // filterByCategory rather than inside a 900-line component — that is what
    // lets inbox-categories.test.ts exercise the parent/child case for real
    // instead of grepping a JSX file for it.
    expect(tab).toMatch(
      /chipCategory,[\s\S]{0,400}from '\.\.\/\.\.\/\.\.\/\.\.\/shared\/inbox-categories'/,
    )
    expect(read('src/shared/inbox-categories.ts')).toContain('export function chipCategory')
  })
})
