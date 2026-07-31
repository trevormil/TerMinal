import { test, expect, describe } from 'bun:test'
import { buildTicketLineage, type LineageInputs } from './ticketLineage'

// Minimal shapes — buildTicketLineage only reads the fields asserted here, so the
// fixtures stay honest about what the join actually depends on.
const run = (over: Partial<LineageInputs['runs'][number]> = {}) =>
  ({
    id: 'r1',
    source: 'agent',
    agentId: 'a',
    agentTitle: 'Implement #12',
    engine: 'codex',
    status: 'done',
    startedAt: 1000,
    repoRoot: '/r',
    repoLabel: 'r',
    branch: 'main',
    worktree: '/r',
    ...over,
  }) as LineageInputs['runs'][number]

const ticket = (over: Record<string, unknown> = {}) =>
  ({ slug: '0012-thing', id: 12, ...over }) as LineageInputs['ticket']

/** Every fixture run defaults to repoRoot '/r', so that is the active repo. */
const build = (input: Omit<LineageInputs, 'repoRoot'> & { repoRoot?: string }) =>
  buildTicketLineage({ repoRoot: '/r', ...input })

describe('buildTicketLineage', () => {
  test('does not attribute another repo’s identically-slugged runs or their cost', () => {
    // runs:all is global across every managed repo and ticket numbering is
    // per-repo, so '0012-thing' can exist in two repos at once. Without a
    // repoRoot filter the other repo's runs — and dollars — land on this card.
    const l = build({
      ticket: ticket(),
      repoRoot: '/repo-a',
      runs: [
        run({ id: 'a1', repoRoot: '/repo-a', trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'b1', repoRoot: '/repo-b', trace: { ticketSlug: '0012-thing' } }),
      ],
      aiRuns: [
        { runId: 'a1', costUsd: 1 },
        { runId: 'b1', costUsd: 40 },
      ],
    })
    expect(l.runs.map((r) => r.id)).toEqual(['a1'])
    expect(l.runCount).toBe(1)
    expect(l.totalCostUsd).toBe(1)
  })

  test('does not adopt a frontmatter-linked run that ran in another repo', () => {
    const l = build({
      ticket: ticket({ run: { id: 'sess1', source: 'session' } }),
      repoRoot: '/repo-a',
      runs: [run({ id: 'sess1', source: 'session', repoRoot: '/repo-b' })],
      aiRuns: [],
    })
    expect(l.runs).toEqual([])
    expect(l.runCount).toBe(0)
  })

  test('collects runs tagged with this ticket via trace.ticketSlug', () => {
    const l = build({
      ticket: ticket(),
      runs: [
        run({ id: 'a1', trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'a2', trace: { ticketSlug: '0012-thing' } }),
      ],
      aiRuns: [],
    })
    expect(l.runs.map((r) => r.id).sort()).toEqual(['a1', 'a2'])
    expect(l.runCount).toBe(2)
  })

  test('ignores runs belonging to a different ticket', () => {
    const l = build({
      ticket: ticket(),
      runs: [
        run({ id: 'mine', trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'theirs', trace: { ticketSlug: '0099-other' } }),
        run({ id: 'untagged' }),
      ],
      aiRuns: [],
    })
    expect(l.runs.map((r) => r.id)).toEqual(['mine'])
  })

  test("includes the ticket's recorded run even when it carries no trace", () => {
    // Session runs are linked through the ticket's own frontmatter, not a trace.
    const l = build({
      ticket: ticket({ run: { id: 'sess1', source: 'session' } }),
      runs: [run({ id: 'sess1', source: 'session' })],
      aiRuns: [],
    })
    expect(l.runs.map((r) => r.id)).toEqual(['sess1'])
    expect(l.linkedRunId).toBe('sess1')
  })

  test('does not double-count a run that is both traced and recorded', () => {
    const l = build({
      ticket: ticket({ run: { id: 'a1', source: 'agent' } }),
      runs: [run({ id: 'a1', trace: { ticketSlug: '0012-thing' } })],
      aiRuns: [],
    })
    expect(l.runs).toHaveLength(1)
    expect(l.runCount).toBe(1)
  })

  test('sorts newest first', () => {
    const l = build({
      ticket: ticket(),
      runs: [
        run({ id: 'old', startedAt: 100, trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'new', startedAt: 900, trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'mid', startedAt: 500, trace: { ticketSlug: '0012-thing' } }),
      ],
      aiRuns: [],
    })
    expect(l.runs.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
  })

  test("prefers a run's own reported cost over the ledger", () => {
    // or-agent/OpenRouter runs self-report costUsd; that beats the AIRun ledger,
    // matching how the Runs tab resolves the same conflict.
    const l = build({
      ticket: ticket(),
      runs: [run({ id: 'a1', costUsd: 0.5, trace: { ticketSlug: '0012-thing' } })],
      aiRuns: [{ runId: 'a1', costUsd: 999 }],
    })
    expect(l.runs[0].costUsd).toBe(0.5)
    expect(l.totalCostUsd).toBe(0.5)
  })

  test('falls back to the ledger, summing every AIRun for one run id', () => {
    const l = build({
      ticket: ticket(),
      runs: [run({ id: 'a1', trace: { ticketSlug: '0012-thing' } })],
      aiRuns: [
        { runId: 'a1', costUsd: 0.25 },
        { runId: 'a1', costUsd: 0.75 },
        { runId: 'other', costUsd: 100 },
      ],
    })
    expect(l.runs[0].costUsd).toBe(1)
    expect(l.totalCostUsd).toBe(1)
  })

  test('totals cost across every run in the lineage', () => {
    const l = build({
      ticket: ticket(),
      runs: [
        run({ id: 'a1', costUsd: 1.5, trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'a2', trace: { ticketSlug: '0012-thing' } }),
      ],
      aiRuns: [{ runId: 'a2', costUsd: 2 }],
    })
    expect(l.totalCostUsd).toBe(3.5)
  })

  test('reports zero cost rather than NaN when nothing is known', () => {
    const l = build({
      ticket: ticket(),
      runs: [run({ id: 'a1', trace: { ticketSlug: '0012-thing' } })],
      aiRuns: [],
    })
    expect(l.runs[0].costUsd).toBe(0)
    expect(l.totalCostUsd).toBe(0)
    expect(l.hasCost).toBe(false)
  })

  test('flags that cost is known once any run has a price', () => {
    const l = build({
      ticket: ticket(),
      runs: [run({ id: 'a1', trace: { ticketSlug: '0012-thing' } })],
      aiRuns: [{ runId: 'a1', costUsd: 0.01 }],
    })
    expect(l.hasCost).toBe(true)
  })

  test('empty inputs produce an empty lineage, not a crash', () => {
    const l = build({ ticket: ticket(), runs: [], aiRuns: [] })
    expect(l.runs).toEqual([])
    expect(l.runCount).toBe(0)
    expect(l.totalCostUsd).toBe(0)
    expect(l.linkedRunId).toBeUndefined()
  })

  test('surfaces a running run so the card can show live work', () => {
    const l = build({
      ticket: ticket(),
      runs: [
        run({ id: 'a1', status: 'done', startedAt: 100, trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'a2', status: 'running', startedAt: 200, trace: { ticketSlug: '0012-thing' } }),
      ],
      aiRuns: [],
    })
    expect(l.running).toBe(true)
  })

  test('is not running when every run has finished', () => {
    const l = build({
      ticket: ticket(),
      runs: [run({ id: 'a1', status: 'failed', trace: { ticketSlug: '0012-thing' } })],
      aiRuns: [],
    })
    expect(l.running).toBe(false)
  })
})
