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

// persistentAgentsRoot() resolves per call through configPath(), so nothing here
// can reach the operator's real ~/.config/TerMinal/persistent-agents.
let cfg = ''
let root = ''
const realCfg = process.env.TERMINAL_CONFIG_DIR

beforeEach(() => {
  cfg = mkdtempSync(join(tmpdir(), 'tm-persistent-'))
  process.env.TERMINAL_CONFIG_DIR = cfg
  root = join(cfg, 'persistent-agents')
})

afterEach(() => {
  rmSync(cfg, { recursive: true, force: true })
  if (realCfg === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = realCfg
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

  const archives = (dir: string) =>
    existsSync(join(dir, 'archive')) ? readdirSync(join(dir, 'archive')) : []

  test('a failing summarizer aborts and leaves NO orphan archive behind', async () => {
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
    expect(readFileSync(join(dir, 'JOURNAL.md'), 'utf8')).toBe(original)
    expect(emits).toEqual([])
    // The archive taken before the summarizer must be cleaned up — otherwise a
    // rate-limited summarizer piles up a full journal copy on every launch.
    expect(archives(dir)).toEqual([])
  })

  test('repeated summarizer failures never accumulate archives', async () => {
    const dir = seed('big', 200)
    const boom = opts({
      summarize: async () => {
        throw new Error('rate limited')
      },
    })
    for (let i = 0; i < 5; i++) await compactPersistentAgentMemory('big', boom)
    expect(archives(dir)).toEqual([])
  })

  test('an empty summary is treated as a failure, not as a valid compaction', async () => {
    const dir = seed('big', 200)
    const original = readFileSync(join(dir, 'JOURNAL.md'), 'utf8')
    const res = await compactPersistentAgentMemory('big', opts({ summarize: async () => '   ' }))
    expect(res.compacted).toBe(false)
    expect(readFileSync(join(dir, 'JOURNAL.md'), 'utf8')).toBe(original)
    expect(archives(dir)).toEqual([])
  })

  // The highest-risk path here: compaction is kicked off by a launch, and the
  // agent that launch spawned appends to JOURNAL.md from a SEPARATE OS process
  // while the summarizer call is still in flight.
  test('preserves entries appended by the running agent DURING summarization', async () => {
    const dir = seed('big', 200)
    const journalPath = join(dir, 'JOURNAL.md')
    const original = readFileSync(journalPath, 'utf8')
    const liveEntry = '\n## Run 200\n- work done while the summarizer was running\n'

    const res = await compactPersistentAgentMemory(
      'big',
      opts({
        summarize: async () => {
          writeFileSync(journalPath, readFileSync(journalPath, 'utf8') + liveEntry)
          return 'compacted summary'
        },
      }),
    )

    expect(res.compacted).toBe(true)
    const next = readFileSync(journalPath, 'utf8')
    // This entry is in neither the archive (taken before) nor the pre-await
    // snapshot, so losing it would be permanent.
    expect(next).toContain('work done while the summarizer was running')
    expect(next).toContain('## Run 200')
    // Still a real compaction, not a no-op.
    expect(next.length).toBeLessThan(original.length)
  })

  test('aborts without truncating if the journal is rewritten during summarization', async () => {
    const dir = seed('big', 200)
    const journalPath = join(dir, 'JOURNAL.md')
    const replacement = '# Journal\n\n## Run X\n- someone rewrote this by hand\n'

    const res = await compactPersistentAgentMemory(
      'big',
      opts({
        summarize: async () => {
          writeFileSync(journalPath, replacement)
          return 'summary'
        },
      }),
    )

    expect(res.compacted).toBe(false)
    expect(res.reason).toContain('changed during summarization')
    expect(readFileSync(journalPath, 'utf8')).toBe(replacement)
    expect(archives(dir)).toEqual([])
  })

  test('a second concurrent compaction is refused rather than doubling the work', async () => {
    const dir = seed('big', 200)
    let calls = 0
    const slow = opts({
      summarize: async () => {
        calls++
        await Bun.sleep(20)
        return 'summary'
      },
    })
    const [a, b] = await Promise.all([
      compactPersistentAgentMemory('big', slow),
      compactPersistentAgentMemory('big', slow),
    ])
    expect(calls).toBe(1)
    expect([a.compacted, b.compacted].filter(Boolean)).toHaveLength(1)
    expect(archives(dir)).toHaveLength(1)
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
