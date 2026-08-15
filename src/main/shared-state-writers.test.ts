import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { TARGETS as BUILT } from '../../scripts/build-bin'

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
const SHARED_STATE = ['hitl.json', 'monitors.json', 'schedules.json'] as const
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
  walk(join(ROOT, 'src/shared'))
  for (const dir of new Set(Object.values(BUILT))) walk(join(ROOT, 'src', dir))
  for (const name of readdirSync(join(ROOT, 'bin'))) {
    // The BUILT artifacts are bundles of the src/ dirs walked above; scanning
    // one would pin the bundler's quoting style, not a writer.
    if (name.startsWith('terminal-') && !BUILT[name]) out.push(join('bin', name))
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
  Record<string, 'updateJsonState' | 'updateJsonListShared' | 'updateInbox' | 'read-only'>
> = {
  'hitl.json': {
    // ONE writer now. Every process — the app, cron, the CLI, the MCP server —
    // mutates the inbox through src/shared/inbox-store.ts, which holds the same
    // advisory lock on hitl.json and additionally owns the append-only archive
    // and the counts index. Anything else that names the path only resolves it.
    'src/shared/inbox-store.ts': 'updateInbox',
    'src/main/hitl.ts': 'read-only',
    'src/main/remote-host-script.cjs': 'updateJsonListShared',
    // The bundled processes name each shared path exactly once, in their path
    // seam; the modules that mutate them are pinned by the constant-following
    // suite below.
    'src/runner/config.ts': 'read-only',
    'src/cli/env.ts': 'read-only',
    'src/mcp/env.ts': 'read-only',
  },
  'monitors.json': {
    'src/main/monitors.ts': 'updateJsonState',
    // The daemon and the CLI each name the path once, in their own path module;
    // the writes are pinned by the constant-following suite below.
    'src/monitor/paths.ts': 'read-only',
    'src/cli/env.ts': 'read-only',
  },
  'schedules.json': {
    'src/main/schedules.ts': 'updateJsonState',
    'src/main/agents.ts': 'read-only',
    'src/main/remote-host-script.cjs': 'updateJsonListShared',
    'src/runner/config.ts': 'read-only',
    'src/mcp/reads.ts': 'read-only',
    'src/mcp/repo.ts': 'read-only',
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

        // The store resolves the path once and writes through `p.hot`, so the
        // literal-line scan cannot see its writes. The dedicated suite at the
        // bottom of this file pins them instead; here we only assert it is the
        // module that actually carries the mutator.
        if (how === 'updateInbox') {
          expect(source).toContain('export function updateInbox')
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

describe('the last hand-copy of the lock helper, and no more (ticket 0132)', () => {
  // src/main/remote-host-script.cjs is copied to a remote host on its own, with
  // no sibling modules and no bundler, so it still inlines the helper — and
  // src/main/remote-state-lock.test.ts drives THAT copy in real concurrent
  // processes. Every other standalone process is now a bundle of typed sources
  // that import src/runner/state-io.ts, whose own concurrency proof is
  // src/runner/state-io.test.ts.
  test('remote-host-script.cjs still carries one, and is exercised', () => {
    const source = readFileSync(join(ROOT, 'src/main/remote-host-script.cjs'), 'utf8')
    expect(source).toContain('// --- crash-safe shared-state writes')
    expect(source).toContain('function withFileLockShared')
    expect(source).toContain('function updateJsonListShared')
    expect(readFileSync(join(ROOT, 'src/main/remote-state-lock.test.ts'), 'utf8')).toContain(
      'REMOTE_SCRIPT inlines a working shared-state lock',
    )
  })

  test('no bundled source re-inlines one', () => {
    // Re-inlining would silently reintroduce the drift this ticket removed, and
    // the concurrency proof would no longer cover what actually ships.
    const offenders = SOURCES.filter(
      (rel) =>
        ['src/runner/', 'src/cli/', 'src/mcp/', 'src/monitor/'].some((d) => rel.startsWith(d)) &&
        rel !== 'src/runner/state-io.ts' &&
        readFileSync(join(ROOT, rel), 'utf8').includes('function withFileLockShared'),
    )
    expect(offenders).toEqual([])
  })
})

describe('the bundled processes mutate shared state through the same lock (ticket 110)', () => {
  // src/runner, src/cli and src/monitor resolve every shared path through a
  // path seam, so the literal-filename scan above cannot see their writers.
  // Follow the CONSTANT instead: any line that names one and performs an
  // unlocked write is the same bug the discipline suite exists to catch.
  const CONST_FOR: Partial<Record<SharedFile, string>> = {
    'hitl.json': 'HITL_FILE()',
    'schedules.json': 'SCHED_FILE()',
    'monitors.json': 'MONITORS_FILE()',
  }
  const RAW = /\b(?:writeFileSync|appendFileSync|writeJsonAtomicShared)\s*\(/
  const BUNDLED = ['src/runner/', 'src/cli/', 'src/monitor/']
  const runnerSources = SOURCES.filter((rel) => BUNDLED.some((d) => rel.startsWith(d)))

  test('the scan sees the bundled sources at all', () => {
    expect(runnerSources.length).toBeGreaterThan(15)
  })

  for (const [file, name] of Object.entries(CONST_FOR)) {
    test(`every runner write of ${file} takes the lock`, () => {
      // hitl.json is the one shared file the bundled processes no longer write
      // directly: they hand the path to the inbox store, which takes the same
      // lock. So the locked spelling to look for differs per file.
      const LOCKED = file === 'hitl.json' ? 'inboxPathsFor' : 'updateJsonListShared'
      const mentioning: string[] = []
      for (const rel of runnerSources) {
        for (const line of readFileSync(join(ROOT, rel), 'utf8').split('\n')) {
          if (!line.includes(name)) continue
          mentioning.push(`${rel}  ${line.trim()}`)
          if (RAW.test(line)) expect(`${rel}  ${line.trim()}`).toContain(LOCKED)
        }
      }
      // A guard that matches nothing is not a guard.
      expect(mentioning.length).toBeGreaterThan(0)
      expect(mentioning.some((l) => l.includes(LOCKED))).toBe(true)
    })
  }
})

describe('the inbox store owns every inbox file, and holds one lock over all of them', () => {
  // The hot/archive split turned one state file into four. That is only safe
  // while ONE module writes them, inside ONE lock — an archive append that
  // races the hot rewrite is how an item ends up in neither.
  const STORE = 'src/shared/inbox-store.ts'
  const INBOX_FILES = ['hitl-archive.jsonl', 'hitl-counts.json', 'hitl-archive-hidden.json']

  test('nothing but the store names the archive, counts or hidden files', () => {
    const namers = SOURCES.filter((rel) => {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      return INBOX_FILES.some((f) => src.includes(`'${f}'`))
    })
    expect(namers).toEqual([STORE])
  })

  test('every write in the store happens inside withFileLockShared', () => {
    const src = readFileSync(join(ROOT, STORE), 'utf8')
    // The lock is taken on the HOT path, which is the same lock the app,
    // terminal-cron, terminal-cli and the MCP server have always contended for.
    expect(src).toContain('withFileLockShared(p.hot')

    // Locate the one locked region and require every mutation to sit in it.
    const body = src.slice(src.indexOf('withFileLockShared(p.hot'))
    for (const call of ['appendFileSync(p.archive', 'writeJsonAtomicShared(p.hot']) {
      expect(src).toContain(call)
      expect(body).toContain(call)
    }
  })

  test('the archive append precedes the hot rewrite, so a crash duplicates rather than loses', () => {
    const src = readFileSync(join(ROOT, STORE), 'utf8')
    const append = src.indexOf('appendFileSync(p.archive')
    const hidden = src.indexOf('writeJsonAtomicShared(p.hidden')
    const hot = src.indexOf('writeJsonAtomicShared(p.hot')
    const counts = src.indexOf('writeJsonAtomicShared(p.counts')
    expect(append).toBeGreaterThan(-1)
    expect(append).toBeLessThan(hidden)
    expect(hidden).toBeLessThan(hot)
    expect(hot).toBeLessThan(counts)
  })
})
