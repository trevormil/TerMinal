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
  test('does not attribute another repo’s identically-slugged runs', () => {
    // runs:all is global across every managed repo and ticket numbering is
    // per-repo, so '0012-thing' can exist in two repos at once. Without a
    // repoRoot filter the other repo's runs land on this ticket.
    const l = build({
      ticket: ticket(),
      repoRoot: '/repo-a',
      runs: [
        run({ id: 'a1', repoRoot: '/repo-a', trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'b1', repoRoot: '/repo-b', trace: { ticketSlug: '0012-thing' } }),
      ],
    })
    expect(l.runs.map((r) => r.id)).toEqual(['a1'])
    expect(l.runCount).toBe(1)
  })

  test('does not adopt a frontmatter-linked run that ran in another repo', () => {
    const l = build({
      ticket: ticket({ run: { id: 'sess1', source: 'session' } }),
      repoRoot: '/repo-a',
      runs: [run({ id: 'sess1', source: 'session', repoRoot: '/repo-b' })],
    })
    expect(l.runs).toEqual([])
    expect(l.runCount).toBe(0)
  })

  test('an unknown repo root claims nothing rather than everything', () => {
    // The detail pane can render before tab context resolves. An empty repoRoot
    // must match no runs at all — the UI says "no repo context" instead of
    // silently showing another repo's history.
    const l = build({
      ticket: ticket(),
      repoRoot: '',
      runs: [run({ id: 'a1', trace: { ticketSlug: '0012-thing' } })],
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
    })
    expect(l.runs.map((r) => r.id)).toEqual(['mine'])
  })

  test("includes the ticket's recorded run even when it carries no trace", () => {
    // Session runs are linked through the ticket's own frontmatter, not a trace.
    const l = build({
      ticket: ticket({ run: { id: 'sess1', source: 'session' } }),
      runs: [run({ id: 'sess1', source: 'session' })],
    })
    expect(l.runs.map((r) => r.id)).toEqual(['sess1'])
    expect(l.linkedRunId).toBe('sess1')
  })

  test('does not double-count a run that is both traced and recorded', () => {
    const l = build({
      ticket: ticket({ run: { id: 'a1', source: 'agent' } }),
      runs: [run({ id: 'a1', trace: { ticketSlug: '0012-thing' } })],
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
    })
    expect(l.runs.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
  })

  test('empty inputs produce an empty lineage, not a crash', () => {
    const l = build({ ticket: ticket(), runs: [] })
    expect(l.runs).toEqual([])
    expect(l.runCount).toBe(0)
    expect(l.running).toBe(false)
    expect(l.linkedRunId).toBeUndefined()
  })

  test('surfaces a running run so the tab can show live work', () => {
    const l = build({
      ticket: ticket(),
      runs: [
        run({ id: 'a1', status: 'done', startedAt: 100, trace: { ticketSlug: '0012-thing' } }),
        run({ id: 'a2', status: 'running', startedAt: 200, trace: { ticketSlug: '0012-thing' } }),
      ],
    })
    expect(l.running).toBe(true)
  })

  test('is not running when every run has finished', () => {
    const l = build({
      ticket: ticket(),
      runs: [run({ id: 'a1', status: 'failed', trace: { ticketSlug: '0012-thing' } })],
    })
    expect(l.running).toBe(false)
  })
})
