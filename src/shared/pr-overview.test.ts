import { describe, expect, test } from 'bun:test'
import { analyzePrDiff, classifyPath, CLASS_RULES, EMPTY_PR_OVERVIEW } from './pr-overview'

// The overview is the thing a reviewer reads INSTEAD of the diff, so a wrong
// number here is worse than no number at all: it silently redirects attention.
// Every rule below is pinned against a real unified-diff fixture rather than a
// hand-built object, because the parser and the classifier fail together.

const hunk = (adds: number, dels: number): string =>
  [
    `@@ -1,${dels + 1} +1,${adds + 1} @@`,
    ' context',
    ...Array.from({ length: dels }, (_, i) => `-old ${i}`),
    ...Array.from({ length: adds }, (_, i) => `+new ${i}`),
  ].join('\n')

const modified = (path: string, adds: number, dels: number): string =>
  [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    hunk(adds, dels),
  ].join('\n')

const added = (path: string, adds: number): string =>
  [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    'index 0000000..2222222',
    '--- /dev/null',
    `+++ b/${path}`,
    hunk(adds, 0),
  ].join('\n')

const deleted = (path: string, dels: number): string =>
  [
    `diff --git a/${path} b/${path}`,
    'deleted file mode 100644',
    'index 1111111..0000000',
    `--- a/${path}`,
    '+++ /dev/null',
    hunk(0, dels),
  ].join('\n')

const renamed = (from: string, to: string): string =>
  [
    `diff --git a/${from} b/${to}`,
    'similarity index 96%',
    `rename from ${from}`,
    `rename to ${to}`,
    `--- a/${from}`,
    `+++ b/${to}`,
    hunk(2, 1),
  ].join('\n')

const binary = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `Binary files a/${path} and b/${path} differ`,
  ].join('\n')

const fileFor = (o: ReturnType<typeof analyzePrDiff>, path: string) =>
  o.files.find((f) => f.path === path)

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('analyzePrDiff parses a unified diff', () => {
  const diff = [
    modified('src/main/agents.ts', 12, 4),
    added('src/main/agents.test.ts', 40),
    deleted('src/main/old.test.ts', 30),
    renamed('src/lib/a.ts', 'src/lib/b.ts'),
    binary('assets/icon.png'),
  ].join('\n')
  const o = analyzePrDiff(diff)

  test('every file in the diff is reported exactly once', () => {
    expect(o.files.map((f) => f.path)).toEqual([
      'src/main/agents.ts',
      'src/main/agents.test.ts',
      'src/main/old.test.ts',
      'src/lib/b.ts',
      'assets/icon.png',
    ])
  })

  test('adds and dels count hunk body lines, not the +++/--- headers', () => {
    expect(fileFor(o, 'src/main/agents.ts')).toMatchObject({ adds: 12, dels: 4, status: 'mod' })
  })

  test('a new file is add, a removed file is del', () => {
    expect(fileFor(o, 'src/main/agents.test.ts')).toMatchObject({
      adds: 40,
      dels: 0,
      status: 'add',
    })
    expect(fileFor(o, 'src/main/old.test.ts')).toMatchObject({ adds: 0, dels: 30, status: 'del' })
  })

  test('a rename reports the new path, keeps the old one, and counts its edits', () => {
    expect(fileFor(o, 'src/lib/b.ts')).toMatchObject({
      status: 'rename',
      oldPath: 'src/lib/a.ts',
      adds: 2,
      dels: 1,
    })
  })

  test('a binary file is flagged and contributes no line churn', () => {
    expect(fileFor(o, 'assets/icon.png')).toMatchObject({ binary: true, adds: 0, dels: 0 })
    expect(o.raw.binaries).toBe(1)
    expect(o.raw.renames).toBe(1)
  })

  test('an empty diff yields the empty overview rather than throwing', () => {
    expect(analyzePrDiff('')).toEqual(EMPTY_PR_OVERVIEW)
    expect(analyzePrDiff('not a diff at all').files).toEqual([])
  })

  test('a stray +/- outside a hunk is not counted as churn', () => {
    const weird = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1..2 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,1 +1,2 @@',
      ' ctx',
      '+one',
    ].join('\n')
    expect(fileFor(analyzePrDiff(weird), 'src/a.ts')).toMatchObject({ adds: 1, dels: 0 })
  })
})

// ---------------------------------------------------------------------------
// Classification — the load-bearing part
// ---------------------------------------------------------------------------

describe('classifyPath', () => {
  const cases: [string, string][] = [
    ['bun.lock', 'lockfile'],
    ['package-lock.json', 'lockfile'],
    ['Cargo.lock', 'lockfile'],
    ['apps/web/pnpm-lock.yaml', 'lockfile'],
    ['go.sum', 'lockfile'],
    ['vendor/github.com/x/y.go', 'vendored'],
    ['node_modules/left-pad/index.js', 'vendored'],
    ['src/__snapshots__/App.test.tsx.snap', 'snapshot'],
    ['src/App.test.tsx.snap', 'snapshot'],
    ['src/main/ipc-channels.ts', 'generated'],
    ['src/api/schema.gen.ts', 'generated'],
    ['proto/service.pb.go', 'generated'],
    ['bin/terminal-cron', 'generated'],
    ['out/main/index.js', 'generated'],
    ['src/main/agents.test.ts', 'test'],
    ['tests/e2e/login.spec.ts', 'test'],
    ['src/__tests__/util.ts', 'test'],
    ['docs/architecture.md', 'docs'],
    ['README.md', 'docs'],
    ['src/main/agents.ts', 'source'],
    ['src/renderer/src/app.css', 'source'],
  ]
  for (const [path, cls] of cases) {
    test(`${path} → ${cls}`, () => {
      expect(classifyPath(path).cls).toBe(cls as never)
    })
  }

  test('noise classes are exactly the four non-source classes', () => {
    expect(classifyPath('bun.lock').noise).toBe(true)
    expect(classifyPath('vendor/x.go').noise).toBe(true)
    expect(classifyPath('a.snap').noise).toBe(true)
    expect(classifyPath('x.gen.ts').noise).toBe(true)
    expect(classifyPath('src/a.ts').noise).toBe(false)
    expect(classifyPath('src/a.test.ts').noise).toBe(false)
    expect(classifyPath('docs/a.md').noise).toBe(false)
  })

  test('a lockfile inside a vendored tree is still a lockfile — order is pinned', () => {
    expect(classifyPath('vendor/pkg/bun.lock').cls).toBe('lockfile')
  })

  test('every rule reports which rule matched, so a surprise is debuggable', () => {
    expect(classifyPath('bun.lock').rule).toBe('lockfile-name')
    expect(classifyPath('src/a.ts').rule).toBe('default')
  })

  test('the rule list is extensible and every rule has a unique id', () => {
    const ids = CLASS_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(5)
  })
})

describe('generated-content sniffing', () => {
  test('an added @generated header classifies a plain path as generated', () => {
    const diff = added('src/models/user.ts', 0).replace(
      '@@ -1,1 +1,1 @@',
      '@@ -0,0 +1,2 @@\n+// @generated by codegen — DO NOT EDIT\n+export type User = { id: string }',
    )
    const o = analyzePrDiff(diff)
    expect(fileFor(o, 'src/models/user.ts')?.cls).toBe('generated')
    expect(fileFor(o, 'src/models/user.ts')?.rule).toBe('generated-header')
  })

  test('the sniff only reads the first few added lines, not the whole file', () => {
    const body = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join('\n')
    const diff = [
      'diff --git a/src/x.ts b/src/x.ts',
      'index 1..2 100644',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -1,1 +1,51 @@',
      body,
      '+// @generated',
    ].join('\n')
    expect(fileFor(analyzePrDiff(diff), 'src/x.ts')?.cls).toBe('source')
  })
})

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

describe('aggregates are computed twice — raw and noise-filtered', () => {
  const diff = [
    modified('src/main/agents.ts', 100, 20),
    modified('src/main/agents.test.ts', 60, 0),
    modified('docs/architecture.md', 10, 2),
    modified('bun.lock', 4000, 120),
    modified('src/api/schema.gen.ts', 300, 300),
  ].join('\n')
  const o = analyzePrDiff(diff)

  test('raw counts everything', () => {
    expect(o.raw.files).toBe(5)
    expect(o.raw.adds).toBe(4470)
    expect(o.raw.dels).toBe(442)
  })

  test('filtered drops lockfiles and generated files', () => {
    expect(o.filtered.files).toBe(3)
    expect(o.filtered.adds).toBe(170)
    expect(o.filtered.dels).toBe(22)
  })

  test('the hidden noise is itemised so nothing disappears silently', () => {
    expect(o.noise.files).toBe(2)
    expect(o.noise.adds).toBe(4300)
    expect(o.noise.byClass.lockfile).toMatchObject({ files: 1, adds: 4000, dels: 120 })
    expect(o.noise.byClass.generated).toMatchObject({ files: 1, adds: 300, dels: 300 })
  })

  test('test ratio is test churn over test+source churn, ignoring docs and noise', () => {
    // source 120, test 60 → 60 / 180
    expect(o.filtered.testRatio).toBeCloseTo(60 / 180, 6)
  })

  test('test ratio is null when nothing testable changed', () => {
    expect(analyzePrDiff(modified('docs/a.md', 3, 1)).filtered.testRatio).toBeNull()
  })

  test('file-type groups roll extensions up and sort by churn', () => {
    const types = o.filtered.byFileType
    expect(types[0]).toMatchObject({ id: 'ts', files: 2, adds: 160, dels: 20 })
    expect(types.map((t) => t.id)).toEqual(['ts', 'md'])
  })

  test('an unknown extension lands in other, not in its own group', () => {
    const t = analyzePrDiff(modified('scripts/thing.pl', 5, 0)).filtered.byFileType
    expect(t).toEqual([{ id: 'other', files: 1, adds: 5, dels: 0 }])
  })

  test('directories roll up at depth 1 and 2, sorted by churn', () => {
    const dirs = o.filtered.byDirectory
    expect(dirs.filter((d) => d.depth === 1).map((d) => d.path)).toEqual(['src', 'docs'])
    expect(dirs.find((d) => d.path === 'src/main')).toMatchObject({
      depth: 2,
      files: 2,
      adds: 160,
      dels: 20,
    })
    // A root-level file has no directory to roll into and must not invent one.
    const root = analyzePrDiff(modified('README.md', 1, 1)).filtered.byDirectory
    expect(root).toEqual([{ path: '.', depth: 1, files: 1, adds: 1, dels: 1 }])
  })

  test('largest-by-churn is capped at five and ordered', () => {
    const many = analyzePrDiff(
      Array.from({ length: 8 }, (_, i) => modified(`src/f${i}.ts`, (i + 1) * 10, 0)).join('\n'),
    )
    expect(many.filtered.largest.map((f) => f.path)).toEqual([
      'src/f7.ts',
      'src/f6.ts',
      'src/f5.ts',
      'src/f4.ts',
      'src/f3.ts',
    ])
  })

  test('per-class totals cover every class present', () => {
    expect(o.raw.byClass.source).toMatchObject({ files: 1, adds: 100, dels: 20 })
    expect(o.raw.byClass.test).toMatchObject({ files: 1, adds: 60, dels: 0 })
    expect(o.raw.byClass.docs).toMatchObject({ files: 1, adds: 10, dels: 2 })
    expect(o.filtered.byClass.lockfile).toMatchObject({ files: 0, adds: 0, dels: 0 })
  })
})

// ---------------------------------------------------------------------------
// Risk hints
// ---------------------------------------------------------------------------

describe('risk hints', () => {
  test('deleting a test file is called out', () => {
    const o = analyzePrDiff([deleted('src/a.test.ts', 40), modified('src/a.ts', 5, 5)].join('\n'))
    expect(o.hints).toContain('Deletes 1 test file')
  })

  test('source changed with no test change is called out', () => {
    const o = analyzePrDiff(modified('src/a.ts', 200, 0))
    expect(o.hints.some((h) => /No test changes/.test(h))).toBe(true)
  })

  test('a new spawn/exec call in the main process is called out', () => {
    const diff = [
      'diff --git a/src/main/runner.ts b/src/main/runner.ts',
      'index 1..2 100644',
      '--- a/src/main/runner.ts',
      '+++ b/src/main/runner.ts',
      '@@ -1,1 +1,2 @@',
      ' ctx',
      "+  const p = spawn('bash', args)",
    ].join('\n')
    expect(analyzePrDiff(diff).hints.some((h) => /spawn/i.test(h))).toBe(true)
  })

  test('a single file dominating the change is called out', () => {
    const o = analyzePrDiff(
      [modified('src/big.ts', 900, 0), modified('src/small.test.ts', 10, 0)].join('\n'),
    )
    expect(o.hints.some((h) => /src\/big\.ts/.test(h))).toBe(true)
  })

  test('binary files are called out because they cannot be reviewed as text', () => {
    const o = analyzePrDiff([binary('a.png'), modified('src/a.test.ts', 1, 0)].join('\n'))
    expect(o.hints.some((h) => /binary/i.test(h))).toBe(true)
  })

  test('a small change never triggers the dominant-file hint — it would fire on everything', () => {
    const o = analyzePrDiff(
      [modified('src/a.ts', 90, 0), modified('src/a.test.ts', 10, 0)].join('\n'),
    )
    expect(o.hints.some((h) => /of the reviewable change/.test(h))).toBe(false)
  })

  test('a clean, tested, small change produces no hints', () => {
    const o = analyzePrDiff(
      [modified('src/a.ts', 10, 2), modified('src/a.test.ts', 20, 0)].join('\n'),
    )
    expect(o.hints).toEqual([])
  })
})
