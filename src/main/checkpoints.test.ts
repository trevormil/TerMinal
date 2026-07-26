import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkpointDir,
  createCheckpoint,
  listCheckpoints,
  parseCheckpointLog,
  restoreCheckpoint,
} from './checkpoints'

// These run against REAL git in a temp workspace — the mechanism is only
// trustworthy if restore actually restores, so mocking it would prove nothing.

const made: string[] = []
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
  test('snapshots, lists, and restores the working tree', () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'original')

    const first = createCheckpoint(ws, 'turn 1')
    expect(first.ok).toBe(true)
    expect(first.sha).not.toBe('')

    // The agent "edits" and adds a file.
    writeFileSync(join(ws, 'a.txt'), 'agent rewrote this')
    writeFileSync(join(ws, 'b.txt'), 'agent added this')
    const second = createCheckpoint(ws, 'turn 2')
    expect(second.sha).not.toBe('')
    expect(second.sha).not.toBe(first.sha)

    expect(listCheckpoints(ws).map((c) => c.label)).toEqual(['turn 2', 'turn 1'])

    // Roll back to before the agent's edit.
    const r = restoreCheckpoint(ws, first.sha)
    expect(r.ok).toBe(true)
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('original')
    // A file the agent created is removed by the restore.
    expect(existsSync(join(ws, 'b.txt'))).toBe(false)
  })

  test('an unchanged tree does not create a checkpoint', () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'x')
    expect(createCheckpoint(ws, 'first').sha).not.toBe('')
    const again = createCheckpoint(ws, 'nothing changed')
    expect(again.ok).toBe(true)
    expect(again.sha).toBe('') // no empty commit spam
    expect(listCheckpoints(ws)).toHaveLength(1)
  })

  test('restoring is itself undoable — it checkpoints first', () => {
    const ws = workspace()
    writeFileSync(join(ws, 'a.txt'), 'v1')
    const v1 = createCheckpoint(ws, 'v1').sha
    writeFileSync(join(ws, 'a.txt'), 'v2')
    createCheckpoint(ws, 'v2')

    const r = restoreCheckpoint(ws, v1)
    expect(r.ok).toBe(true)
    expect(r.backup).not.toBe('') // the pre-restore state was saved
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('v1')

    // …and that backup can be restored, recovering the "lost" v2.
    expect(restoreCheckpoint(ws, r.backup!).ok).toBe(true)
    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('v2')
  })

  test('honours .gitignore, so build output is not snapshotted', () => {
    const ws = workspace()
    writeFileSync(join(ws, '.gitignore'), 'dist/\n')
    mkdirSync(join(ws, 'dist'))
    writeFileSync(join(ws, 'dist', 'bundle.js'), 'huge')
    writeFileSync(join(ws, 'src.ts'), 'code')
    const sha = createCheckpoint(ws, 'with ignore').sha
    expect(sha).not.toBe('')

    const listed = execFileSync(
      'git',
      ['--git-dir', checkpointDir(ws), '--work-tree', ws, 'ls-tree', '-r', '--name-only', sha],
      { encoding: 'utf8' },
    )
    expect(listed).toContain('src.ts')
    expect(listed).not.toContain('bundle.js')
  })

  test('never touches the workspace own .git', () => {
    const ws = workspace()
    execFileSync('git', ['init', '--quiet', ws], { stdio: 'ignore' })
    writeFileSync(join(ws, 'a.txt'), 'x')
    createCheckpoint(ws, 'turn')
    // The real repo has no commits and nothing staged — the shadow repo took it.
    const status = execFileSync('git', ['-C', ws, 'status', '--porcelain'], { encoding: 'utf8' })
    expect(status).toContain('?? a.txt') // still untracked in the USER's repo
    expect(() =>
      execFileSync('git', ['-C', ws, 'rev-parse', 'HEAD'], { stdio: 'ignore' }),
    ).toThrow() // no commits were made there
  })

  test('unknown workspace or sha fails cleanly', () => {
    expect(createCheckpoint('', 'x').ok).toBe(false)
    expect(restoreCheckpoint(workspace(), '').ok).toBe(false)
    expect(listCheckpoints(workspace())).toEqual([])
  })
})
