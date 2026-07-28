import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkpointDir,
  checkpointChangedRanges,
  createCheckpoint,
  fileAtCheckpoint,
  listCheckpoints,
  parseCheckpointLog,
  restoreCheckpoint,
  reviewBaseFor,
} from './checkpoints'

// These run against REAL git in a temp workspace — the mechanism is only
// trustworthy if restore actually restores, so mocking it would prove nothing.

const made: string[] = []
const checkpointRoot = mkdtempSync(join(tmpdir(), 'tm-ckpt-root-'))
process.env.TERMINAL_CHECKPOINT_ROOT = checkpointRoot

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tm-ckpt-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const d of made.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
      rmSync(checkpointDir(d), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

afterAll(() => {
  rmSync(checkpointRoot, { recursive: true, force: true })
  delete process.env.TERMINAL_CHECKPOINT_ROOT
})

describe('parseCheckpointLog', () => {
  test('parses sha, epoch-seconds → ms, and the label', () => {
    expect(parseCheckpointLog('abc123\x001700000000\x00did a thing')).toEqual([
      { sha: 'abc123', at: 1_700_000_000_000, label: 'did a thing' },
    ])
  })
  test('tolerates blank lines and keeps labels containing separators', () => {
    expect(parseCheckpointLog('\nabc\x001700000000\x00a: b\n')).toHaveLength(1)
    expect(parseCheckpointLog('abc\x001700000000\x00a: b')[0].label).toBe('a: b')
  })
  test('drops malformed rows rather than emitting junk', () => {
    expect(parseCheckpointLog('garbage\nabc\x00')).toEqual([])
  })
})

describe('checkpoint lifecycle (real git)', () => {
  test('snapshots, lists, and restores the working tree', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'original')

    const first = await createCheckpoint(ws, 'turn 1')
    expect(first.ok).toBe(true)
    expect(first.sha).not.toBe('')

    // The agent "edits" and adds a file.
    writeFileSync(join(ws, 'a.txt'), 'agent rewrote this')
    writeFileSync(join(ws, 'b.txt'), 'agent added this')
    const second = await createCheckpoint(ws, 'turn 2')
    expect(second.sha).not.toBe('')
    expect(second.sha).not.toBe(first.sha)

    expect((await listCheckpoints(ws)).map((c) => c.label)).toEqual(['turn 2', 'turn 1'])

    // Roll back to before the agent's edit.
    const r = await restoreCheckpoint(ws, first.sha)
    expect(r.ok).toBe(true)
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('original')
    // A file the agent created is removed by the restore.
    expect(existsSync(join(ws, 'b.txt'))).toBe(false)
  })

  test('an unchanged tree does not create a checkpoint', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'x')
    expect((await createCheckpoint(ws, 'first')).sha).not.toBe('')
    const again = await createCheckpoint(ws, 'nothing changed')
    expect(again.ok).toBe(true)
    expect(again.sha).toBe('') // no empty commit spam
    expect(await listCheckpoints(ws)).toHaveLength(1)
  })

  test('checkpoint read helpers return promises', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'v1\n')
    const first = (await createCheckpoint(ws, 'v1')).sha
    writeFileSync(join(ws, 'a.txt'), 'v2\n')
    const second = (await createCheckpoint(ws, 'v2')).sha

    const list = listCheckpoints(ws)
    const file = fileAtCheckpoint(ws, first, 'a.txt')
    const ranges = checkpointChangedRanges(ws, second)
    const base = reviewBaseFor(ws, 'a.txt', 'v2 plus local\n')

    expect(list).toBeInstanceOf(Promise)
    expect(file).toBeInstanceOf(Promise)
    expect(ranges).toBeInstanceOf(Promise)
    expect(base).toBeInstanceOf(Promise)

    expect((await list).map((c) => c.label)).toEqual(['v2', 'v1'])
    expect(await file).toEqual({ ok: true, content: 'v1\n' })
    expect((await ranges)['a.txt']).toEqual([{ from: 1, to: 1 }])
    expect(await base).toMatchObject({ ok: true, sha: first, content: 'v1\n' })
  })

  test('restoring is itself undoable — it checkpoints first', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'v1')
    const v1 = (await createCheckpoint(ws, 'v1')).sha
    writeFileSync(join(ws, 'a.txt'), 'v2')
    await createCheckpoint(ws, 'v2')

    const r = await restoreCheckpoint(ws, v1)
    expect(r.ok).toBe(true)
    expect(r.backup).not.toBe('') // the pre-restore state was saved
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('v1')

    // …and that backup can be restored, recovering the "lost" v2.
    expect((await restoreCheckpoint(ws, r.backup!)).ok).toBe(true)
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('v2')
  })

  test('honours .gitignore, so build output is not snapshotted', async () => {
    const ws = workspace()
    writeFileSync(join(ws, '.gitignore'), 'dist/\n')
    mkdirSync(join(ws, 'dist'))
    writeFileSync(join(ws, 'dist', 'bundle.js'), 'huge')
    writeFileSync(join(ws, 'src.ts'), 'code')
    const sha = (await createCheckpoint(ws, 'with ignore')).sha
    expect(sha).not.toBe('')

    const listed = execFileSync(
      'git',
      ['--git-dir', checkpointDir(ws), '--work-tree', ws, 'ls-tree', '-r', '--name-only', sha],
      { encoding: 'utf8' },
    )
    expect(listed).toContain('src.ts')
    expect(listed).not.toContain('bundle.js')
  })

  test('never touches the workspace own .git', async () => {
    const ws = workspace()
    execFileSync('git', ['init', '--quiet', ws], { stdio: 'ignore' })
    writeFileSync(join(ws, 'a.txt'), 'x')
    await createCheckpoint(ws, 'turn')
    // The real repo has no commits and nothing staged — the shadow repo took it.
    const status = execFileSync('git', ['-C', ws, 'status', '--porcelain'], { encoding: 'utf8' })
    expect(status).toContain('?? a.txt') // still untracked in the USER's repo
    expect(() =>
      execFileSync('git', ['-C', ws, 'rev-parse', 'HEAD'], { stdio: 'ignore' }),
    ).toThrow() // no commits were made there
  })

  test('reads a file at a checkpoint, and empty where it did not exist', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'v1\n')
    const v1 = (await createCheckpoint(ws, 'v1')).sha
    writeFileSync(join(ws, 'a.txt'), 'v2\n')
    writeFileSync(join(ws, 'b.txt'), 'new\n')
    const v2 = (await createCheckpoint(ws, 'v2')).sha

    expect(await fileAtCheckpoint(ws, v1, 'a.txt')).toEqual({ ok: true, content: 'v1\n' })
    expect(await fileAtCheckpoint(ws, v2, 'a.txt')).toEqual({ ok: true, content: 'v2\n' })
    expect(await fileAtCheckpoint(ws, v1, 'b.txt')).toEqual({ ok: true, content: '' })
    // traversal + junk shas refused
    expect((await fileAtCheckpoint(ws, v1, '../escape')).ok).toBe(false)
    expect((await fileAtCheckpoint(ws, 'HEAD; rm -rf', 'a.txt')).ok).toBe(false)
  })

  test('reports the line ranges a checkpoint touched (AI attribution)', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'one\ntwo\nthree\n')
    await createCheckpoint(ws, 'base')
    writeFileSync(join(ws, 'a.txt'), 'one\nTWO CHANGED\nthree\nfour added\n')
    const turn = (await createCheckpoint(ws, 'agent turn')).sha

    const ranges = await checkpointChangedRanges(ws, turn)
    expect(ranges['a.txt']).toEqual([
      { from: 2, to: 2 },
      { from: 4, to: 4 },
    ])
  })

  test('the very first checkpoint attributes every line', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'x\ny\n')
    const first = (await createCheckpoint(ws, 'first')).sha
    expect((await checkpointChangedRanges(ws, first))['a.txt']).toEqual([{ from: 1, to: 2 }])
  })

  test('review base survives local edits after the agent turn', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'v1\n')
    await createCheckpoint(ws, 'turn 1')
    writeFileSync(join(ws, 'a.txt'), 'agent v2\n')
    await createCheckpoint(ws, 'turn 2')
    // The human edits ON TOP of the agent's turn — the turn's edits must
    // still be visible, so the base is turn 1's content, not turn 2's.
    const base = await reviewBaseFor(ws, 'a.txt', 'agent v2 plus my tweak\n')
    expect(base).toMatchObject({ ok: true, content: 'v1\n' })
    // No local edits at all: same answer — the turn's edits are the diff.
    expect(await reviewBaseFor(ws, 'a.txt', 'agent v2\n')).toMatchObject({
      ok: true,
      content: 'v1\n',
    })
  })

  test('review base is the newest checkpoint when the last turn skipped the file', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'stable\n')
    writeFileSync(join(ws, 'b.txt'), 'x\n')
    await createCheckpoint(ws, 'turn 1')
    writeFileSync(join(ws, 'b.txt'), 'y\n') // the turn touched only b.txt
    const second = (await createCheckpoint(ws, 'turn 2')).sha
    // a.txt drifted locally — base is the newest checkpoint, showing just that.
    expect(await reviewBaseFor(ws, 'a.txt', 'stable + local\n')).toMatchObject({
      ok: true,
      sha: second,
      content: 'stable\n',
    })
    // …and with no drift either, checkpoints have nothing to show.
    expect(await reviewBaseFor(ws, 'a.txt', 'stable\n')).toEqual({ ok: false })
  })

  test('overlapping checkpoints for the same repo drop instead of running concurrently', async () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'x')

    const first = createCheckpoint(ws, 'first')
    const second = await createCheckpoint(ws, 'overlap')

    expect(second).toEqual({ ok: true, sha: '' })
    expect((await first).sha).not.toBe('')
    expect((await listCheckpoints(ws)).map((c) => c.label)).toEqual(['first'])
  })

  test('unknown workspace or sha fails cleanly', async () => {
    expect((await createCheckpoint('', 'x')).ok).toBe(false)
    expect((await restoreCheckpoint(workspace(), '')).ok).toBe(false)
    expect(await listCheckpoints(workspace())).toEqual([])
  })
})
