import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectClaudeSessions, collectCodexSessions } from './ai-collectors'
import type { AIRun } from './ai-runs'

// The collectors run at app boot AND on a 5-minute interval, over transcript
// archives that reach into the GB range. These tests pin the incremental
// contract that keeps that affordable: a file whose (size, mtime) is unchanged
// since the last collection is never re-read, let alone re-parsed.

const roots: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tm-collect-'))
  roots.push(d)
  return d
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const turnLine = (tokens: number) =>
  JSON.stringify({
    cwd: '/repo',
    timestamp: Date.now(),
    message: {
      role: 'assistant',
      model: 'claude-sonnet-5',
      usage: { input_tokens: tokens, output_tokens: 5 },
    },
  }) + '\n'

function harness() {
  const written: AIRun[] = []
  return { written, writeRun: (r: AIRun) => void written.push(r) }
}

describe('collectClaudeSessions — incremental', () => {
  test('first run collects, unchanged second run reads nothing, appended file re-collects', async () => {
    const root = tmp()
    const stateFile = join(tmp(), 'state.json')
    mkdirSync(join(root, 'proj-a'), { recursive: true })
    writeFileSync(join(root, 'proj-a', 'sess-1.jsonl'), turnLine(10))
    writeFileSync(join(root, 'proj-a', 'sess-2.jsonl'), turnLine(20))

    const h1 = harness()
    const r1 = await collectClaudeSessions(undefined, {
      root,
      stateFile,
      writeRun: h1.writeRun,
    })
    expect(r1.written).toBe(2)
    expect(h1.written.map((r) => r.id).sort()).toEqual(['claude-sess-1', 'claude-sess-2'])

    // Unchanged: nothing re-written (and, per the contract, nothing re-parsed).
    const h2 = harness()
    const r2 = await collectClaudeSessions(undefined, {
      root,
      stateFile,
      writeRun: h2.writeRun,
    })
    expect(r2.written).toBe(0)
    expect(r2.skipped).toBe(2)
    expect(h2.written).toHaveLength(0)

    // Append a turn → that one file (and only it) is re-collected.
    appendFileSync(join(root, 'proj-a', 'sess-2.jsonl'), turnLine(30))
    const h3 = harness()
    const r3 = await collectClaudeSessions(undefined, {
      root,
      stateFile,
      writeRun: h3.writeRun,
    })
    expect(r3.written).toBe(1)
    expect(h3.written[0].id).toBe('claude-sess-2')
    expect(h3.written[0].inputTokens).toBe(50) // 20 + 30 — totals reflect the whole file
  })

  test('a file with no usage turns is remembered and not re-read either', async () => {
    const root = tmp()
    const stateFile = join(tmp(), 'state.json')
    mkdirSync(join(root, 'proj-a'), { recursive: true })
    writeFileSync(join(root, 'proj-a', 'empty.jsonl'), JSON.stringify({ cwd: '/x' }) + '\n')

    const h1 = harness()
    await collectClaudeSessions(undefined, { root, stateFile, writeRun: h1.writeRun })
    const h2 = harness()
    const r2 = await collectClaudeSessions(undefined, { root, stateFile, writeRun: h2.writeRun })
    expect(r2.skipped).toBe(1)
    expect(h2.written).toHaveLength(0)
  })
})

describe('collectCodexSessions — date-nested layout', () => {
  test('finds rollout jsonl files under YYYY/MM/DD and is incremental across runs', async () => {
    const root = tmp()
    const stateFile = join(tmp(), 'state.json')
    const day = join(root, '2026', '07', '29')
    mkdirSync(day, { recursive: true })
    writeFileSync(
      join(day, 'rollout-2026-07-29-abc.jsonl'),
      JSON.stringify({
        cwd: '/repo',
        model: 'gpt-5',
        timestamp: Date.now(),
        usage: { input_tokens: 7, output_tokens: 3 },
      }) + '\n',
    )

    const h1 = harness()
    const r1 = await collectCodexSessions(undefined, { root, stateFile, writeRun: h1.writeRun })
    expect(r1.written).toBe(1)
    expect(h1.written[0].id).toBe('codex-rollout-2026-07-29-abc')
    expect(h1.written[0].inputTokens).toBe(7)

    const h2 = harness()
    const r2 = await collectCodexSessions(undefined, { root, stateFile, writeRun: h2.writeRun })
    expect(r2.written).toBe(0)
    expect(h2.written).toHaveLength(0)
  })
})
