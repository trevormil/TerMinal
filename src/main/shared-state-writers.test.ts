import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Ticket 110. `withFileLock` is ADVISORY: it protects a file only if every
// process that writes it takes it. Three writers cooperating while a fourth
// writes through them is not "mostly safe" — the fourth manufactures the torn
// read that makes the other three quarantine the file and refuse, which is how
// a 3.2 MB HITL inbox disappears with nothing surfaced.
//
// So the property worth pinning is not "the writers we know about are locked".
// It is "no writer exists that we do not know about" — because the MCP server
// slipped through by being written AFTER ticket 68 converted the others, and
// the next agent will not know that history either.
//
// Two halves, and both are load-bearing:
//   1. DISCOVERY — the set of source files that touch each shared state file is
//      pinned. Adding a toucher fails here and forces a decision.
//   2. DISCIPLINE — each file that MUTATES shared state routes through a lock.

const ROOT = resolve(import.meta.dir, '../..')

/** State files that more than one PROCESS read-modify-writes. */
const SHARED_STATE = ['hitl.json', 'monitors.json', 'schedules.json', 'budgets.json'] as const
type SharedFile = (typeof SHARED_STATE)[number]

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) {
        if (name !== 'node_modules') walk(abs)
      } else if (!name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
        out.push(relative(ROOT, abs))
      }
    }
  }
  walk(join(ROOT, 'src/main'))
  for (const name of readdirSync(join(ROOT, 'bin'))) {
    if (name.startsWith('terminal-')) out.push(join('bin', name))
  }
  return out.sort()
}

const SOURCES = sourceFiles()
const touchers = (file: SharedFile): string[] =>
  SOURCES.filter((rel) => readFileSync(join(ROOT, rel), 'utf8').includes(`'${file}'`))

/**
 * Every file that names a shared state file, and how it is allowed to write it.
 *
 * `'read-only'` is a claim with teeth: the discipline suite below asserts the
 * file contains no write call at all against that path. Downgrading a writer to
 * read-only to silence a failure therefore fails a different test.
 */
const EXPECTED: Record<
  SharedFile,
  Record<string, 'updateJsonState' | 'updateJsonListShared' | 'read-only'>
> = {
  'hitl.json': {
    'src/main/hitl.ts': 'updateJsonState',
    'src/main/bridge/push.ts': 'read-only',
    'src/main/remote.ts': 'updateJsonListShared',
    'bin/terminal-cron': 'updateJsonListShared',
    'bin/terminal-cli': 'updateJsonListShared',
    'bin/terminal-mcp-server': 'updateJsonListShared',
  },
  'monitors.json': {
    'src/main/monitors.ts': 'updateJsonState',
    'bin/terminal-cli': 'updateJsonListShared',
    'bin/terminal-monitor': 'read-only',
  },
  'schedules.json': {
    'src/main/schedules.ts': 'updateJsonState',
    'src/main/agents.ts': 'read-only',
    'src/main/remote.ts': 'updateJsonListShared',
    'bin/terminal-cron': 'updateJsonListShared',
    'bin/terminal-mcp-server': 'read-only',
  },
  'budgets.json': {
    'src/main/budgets.ts': 'updateJsonState',
    'bin/terminal-cron': 'read-only',
  },
}

describe('discovery — no shared-state toucher appears without a decision (ticket 110)', () => {
  for (const file of SHARED_STATE) {
    test(`the set of files naming ${file} is exactly what we have reviewed`, () => {
      expect(touchers(file).sort()).toEqual(Object.keys(EXPECTED[file]).sort())
    })
  }
})

describe('discipline — every mutator of shared state takes the lock (ticket 110)', () => {
  /** Writes that take no lock. Any of these against a shared path is the bug. */
  const RAW_WRITE =
    /\b(?:writeFileSync|appendFileSync|writeJsonAtomic|writeJsonAtomicShared|writeFileAtomic|writeJson)\s*\(/

  for (const file of SHARED_STATE) {
    for (const [rel, how] of Object.entries(EXPECTED[file])) {
      test(`${rel} ${how === 'read-only' ? 'only reads' : 'writes'} ${file}`, () => {
        const source = readFileSync(join(ROOT, rel), 'utf8')

        // Narrow to the statements that actually mention this file, so an
        // unrelated raw write elsewhere in a 2000-line module is not a finding.
        const lines = source.split('\n')
        const mentioning = lines.filter((l) => l.includes(`'${file}'`))
        expect(mentioning.length).toBeGreaterThan(0)

        if (how === 'read-only') {
          for (const line of mentioning) expect(line).not.toMatch(RAW_WRITE)
          return
        }

        // The locked writer must be present AND applied to this path. Both
        // matter: importing `updateJsonState` somewhere in the module proves
        // nothing about the line that writes THIS file.
        expect(source).toContain(how)
        for (const line of mentioning) {
          if (!RAW_WRITE.test(line)) continue
          expect(line).toContain(how)
        }
      })
    }
  }
})

describe('the standalone processes carry the inlined lock helper', () => {
  // bin/ scripts are copied to remote hosts and baked into the agent image with
  // no sibling modules, so they inline the helper instead of importing it.
  // bin-state-lock.test.ts asserts the copies are byte-identical; this asserts
  // that every bin script which mutates shared state has one at all.
  const needsHelper = new Set<string>()
  for (const file of SHARED_STATE) {
    for (const [rel, how] of Object.entries(EXPECTED[file])) {
      if (rel.startsWith('bin/') && how === 'updateJsonListShared') needsHelper.add(rel)
    }
  }

  for (const rel of [...needsHelper].sort()) {
    test(`${rel} inlines the shared-state helper block`, () => {
      const source = readFileSync(join(ROOT, rel), 'utf8')
      expect(source).toContain('// --- crash-safe shared-state writes')
      expect(source).toContain('function withFileLockShared')
      expect(source).toContain('function updateJsonListShared')
    })
  }
})
