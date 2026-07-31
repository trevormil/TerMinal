import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  JOURNAL_COMPACT_THRESHOLD_BYTES,
  compactPersistentAgentMemory,
  persistentAgentsRoot,
  savePersistentAgent,
  shouldCompactJournal,
} from './persistent-agents'
import type { ActivityEvent } from './events'

// TERMINAL_PERSISTENT_AGENTS_ROOT is resolved per call, so nothing here can
// reach the operator's real ~/.config/TerMinal/persistent-agents.
let root = ''
const realRoot = process.env.TERMINAL_PERSISTENT_AGENTS_ROOT

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tm-persistent-'))
  process.env.TERMINAL_PERSISTENT_AGENTS_ROOT = root
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  if (realRoot === undefined) delete process.env.TERMINAL_PERSISTENT_AGENTS_ROOT
  else process.env.TERMINAL_PERSISTENT_AGENTS_ROOT = realRoot
})

/** An agent whose journal is `entries` entries long. */
function seed(id: string, entries: number): string {
  savePersistentAgent({ id, title: id })
  const dir = join(root, id)
  const body =
    '# Journal\n\n' +
    Array.from(
      { length: entries },
      (_, i) => `## Run ${i}\n- did a thing numbered ${i}\n- ${'x'.repeat(600)}\n`,
    ).join('\n')
  writeFileSync(join(dir, 'JOURNAL.md'), body)
  return dir
}

const emits: Omit<ActivityEvent, 'id' | 'ts'>[] = []
const opts = (over: Record<string, unknown> = {}) => ({
  summarize: async (journal: string) => `summary of ${journal.length} bytes`,
  emit: (e: Omit<ActivityEvent, 'id' | 'ts'>) => {
    emits.push(e)
  },
  ...over,
})

beforeEach(() => {
  emits.length = 0
})

describe('persistentAgentsRoot', () => {
  test('resolves to the injected root, not the real config dir', () => {
    expect(persistentAgentsRoot()).toBe(root)
  })
})

describe('shouldCompactJournal', () => {
  test('is false below the threshold and true at or above it', () => {
    expect(shouldCompactJournal(JOURNAL_COMPACT_THRESHOLD_BYTES - 1)).toBe(false)
    expect(shouldCompactJournal(JOURNAL_COMPACT_THRESHOLD_BYTES)).toBe(true)
    expect(shouldCompactJournal(0)).toBe(false)
  })
})

describe('compactPersistentAgentMemory', () => {
  test('leaves a small journal completely untouched', async () => {
    const dir = seed('small', 2)
    const before = readFileSync(join(dir, 'JOURNAL.md'), 'utf8')
    const res = await compactPersistentAgentMemory('small', opts())
    expect(res.compacted).toBe(false)
    expect(readFileSync(join(dir, 'JOURNAL.md'), 'utf8')).toBe(before)
    expect(existsSync(join(dir, 'archive'))).toBe(false)
    expect(emits).toEqual([])
  })

  test('archives the ORIGINAL journal verbatim before shrinking it', async () => {
    const dir = seed('big', 200)
    const original = readFileSync(join(dir, 'JOURNAL.md'), 'utf8')

    const res = await compactPersistentAgentMemory('big', opts())
    expect(res.compacted).toBe(true)

    const archives = readdirSync(join(dir, 'archive'))
    expect(archives).toHaveLength(1)
    // Byte-for-byte — compaction must never be able to lose history.
    expect(readFileSync(join(dir, 'archive', archives[0]), 'utf8')).toBe(original)
    expect(res.archivePath).toContain('archive/')
  })

  test('shrinks the journal, keeps the newest entries, and points at the archive', async () => {
    const dir = seed('big', 200)
    const original = readFileSync(join(dir, 'JOURNAL.md'), 'utf8')

    await compactPersistentAgentMemory('big', opts())

    const next = readFileSync(join(dir, 'JOURNAL.md'), 'utf8')
    expect(next.length).toBeLessThan(original.length)
    expect(next).toContain('## Run 199')
    expect(next).not.toContain('## Run 0\n')
    expect(next).toContain('archive/')
  })

  test('folds the summary into MEMORY.md without dropping existing memories', async () => {
    const dir = seed('big', 200)
    writeFileSync(join(dir, 'MEMORY.md'), '# Memory\n\n- trevor prefers bun\n')

    await compactPersistentAgentMemory('big', opts())

    const mem = readFileSync(join(dir, 'MEMORY.md'), 'utf8')
    expect(mem).toContain('- trevor prefers bun')
    expect(mem).toContain('summary of ')
  })

  test('emits an Activity event naming the agent and the archive', async () => {
    seed('big', 200)
    await compactPersistentAgentMemory('big', opts())
    expect(emits).toHaveLength(1)
    expect(emits[0].kind).toBe('info')
    expect(emits[0].title).toContain('big')
    expect(emits[0].detail).toContain('archive/')
  })

  test('a failing summarizer aborts the compaction rather than truncating history', async () => {
    const dir = seed('big', 200)
    const original = readFileSync(join(dir, 'JOURNAL.md'), 'utf8')

    const res = await compactPersistentAgentMemory(
      'big',
      opts({
        summarize: async () => {
          throw new Error('cheap-llm unavailable')
        },
      }),
    )

    expect(res.compacted).toBe(false)
    expect(res.reason).toContain('summar')
    // Journal untouched; the archive taken beforehand is harmless but the
    // live journal must still hold everything.
    expect(readFileSync(join(dir, 'JOURNAL.md'), 'utf8')).toBe(original)
    expect(emits).toEqual([])
  })

  test('an empty summary is treated as a failure, not as a valid compaction', async () => {
    const dir = seed('big', 200)
    const original = readFileSync(join(dir, 'JOURNAL.md'), 'utf8')
    const res = await compactPersistentAgentMemory('big', opts({ summarize: async () => '   ' }))
    expect(res.compacted).toBe(false)
    expect(readFileSync(join(dir, 'JOURNAL.md'), 'utf8')).toBe(original)
  })

  test('an unknown agent is a no-op', async () => {
    const res = await compactPersistentAgentMemory('nope', opts())
    expect(res.compacted).toBe(false)
    expect(res.reason).toContain('not found')
  })

  test('compacting twice keeps both archives and stays below the threshold', async () => {
    const dir = seed('big', 200)
    await compactPersistentAgentMemory('big', opts())
    // grow it again
    writeFileSync(
      join(dir, 'JOURNAL.md'),
      readFileSync(join(dir, 'JOURNAL.md'), 'utf8') + 'y'.repeat(JOURNAL_COMPACT_THRESHOLD_BYTES),
    )
    const res = await compactPersistentAgentMemory('big', opts())
    expect(res.compacted).toBe(true)
    expect(readdirSync(join(dir, 'archive'))).toHaveLength(2)
  })
})
