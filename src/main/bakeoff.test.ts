import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Route ALL bake-off persistence at a throwaway dir BEFORE importing the module
// under test — a bake-off record must never land in the user's real
// ~/.config/TerMinal.
const ROOT = mkdtempSync(join(tmpdir(), 'tm-bakeoff-'))
process.env.TERMINAL_BAKEOFF_ROOT = ROOT

const {
  startBakeOff,
  planBakeOff,
  parseNumstat,
  parseJudgeVerdict,
  applyRunStatuses,
  buildJudgePrompt,
  saveBakeOff,
  refreshBakeOffStatus,
  ESTIMATED_ENTRANT_USD,
  getBakeOff,
  listBakeOffs,
  pickWinner,
  MAX_ENTRANTS,
} = await import('./bakeoff')
type BakeOff = import('./bakeoff').BakeOff

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const allow = { decision: 'allow' as const }
const refuse = { decision: 'refuse' as const, reason: 'daily cap of $5.00 reached' }

describe('planBakeOff', () => {
  test('normalizes a two-engine bake-off and assigns stable entrant ids', () => {
    const p = planBakeOff([{ engine: 'claude' }, { engine: 'codex', model: 'gpt-5' }], allow)
    if ('error' in p) throw new Error(p.error)
    expect(p.entrants.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(p.entrants[1]).toMatchObject({ engine: 'codex', model: 'gpt-5', status: 'pending' })
  })

  test('refuses a single entrant — a bake-off needs something to compare against', () => {
    const p = planBakeOff([{ engine: 'claude' }], allow)
    expect('error' in p && p.error).toMatch(/at least 2/i)
  })

  test('collapses duplicate engine+model pairs rather than running the same thing twice', () => {
    const p = planBakeOff(
      [
        { engine: 'codex', model: 'gpt-5' },
        { engine: 'codex', model: 'gpt-5' },
        { engine: 'claude' },
      ],
      allow,
    )
    if ('error' in p) throw new Error(p.error)
    expect(p.entrants).toHaveLength(2)
    expect(p.entrants.map((e) => e.engine)).toEqual(['codex', 'claude'])
  })

  test('same engine with DIFFERENT models is a legitimate bake-off, not a duplicate', () => {
    const p = planBakeOff(
      [
        { engine: 'codex', model: 'gpt-5' },
        { engine: 'codex', model: 'o3' },
      ],
      allow,
    )
    if ('error' in p) throw new Error(p.error)
    expect(p.entrants).toHaveLength(2)
  })

  test('caps fan-out at MAX_ENTRANTS instead of silently spawning a large fleet', () => {
    const many = ['claude', 'codex', 'cursor', 'openrouter', 'hermes'].map((engine) => ({
      engine: engine as 'claude',
    }))
    const p = planBakeOff(many, allow)
    expect('error' in p && p.error).toMatch(new RegExp(`${MAX_ENTRANTS}`))
  })

  test('a refusing budget gate blocks the whole fan-out and surfaces the cap reason', () => {
    const p = planBakeOff([{ engine: 'claude' }, { engine: 'codex' }], refuse)
    expect('error' in p && p.error).toContain('daily cap of $5.00 reached')
  })

  test('a warning budget gate still allows the run, but surfaces the reason', () => {
    const p = planBakeOff([{ engine: 'claude' }, { engine: 'codex' }], {
      decision: 'warn',
      reason: 'at 80% of daily cap',
    })
    if ('error' in p) throw new Error(p.error)
    // Swallowing the warn would let N runs launch with no signal at all.
    expect(p.warning).toBe('at 80% of daily cap')
  })

  test('an allowing gate carries no warning', () => {
    const p = planBakeOff([{ engine: 'claude' }, { engine: 'codex' }], allow)
    if ('error' in p) throw new Error(p.error)
    expect(p.warning).toBeUndefined()
  })

  // gateSpawn is retrospective: at $19.90 of a $20 cap it says "allow", which is
  // true for ONE run and catastrophically wrong for four.
  test('refuses when N entrants project past the remaining cap, even on an "allow"', () => {
    const p = planBakeOff([{ engine: 'claude' }, { engine: 'codex' }, { engine: 'cursor' }], {
      decision: 'allow',
      capRemainingUsd: 0.1,
    })
    expect('error' in p && p.error).toMatch(/only \$0\.10 is left/)
  })

  test('allows the same fan-out when the remaining cap actually covers it', () => {
    const p = planBakeOff([{ engine: 'claude' }, { engine: 'codex' }], {
      decision: 'allow',
      capRemainingUsd: 2 * ESTIMATED_ENTRANT_USD,
    })
    expect('error' in p).toBe(false)
  })

  test('an unlimited cap (Infinity remaining) is never projected against', () => {
    const p = planBakeOff([{ engine: 'claude' }, { engine: 'codex' }], {
      decision: 'allow',
      capRemainingUsd: Infinity,
    })
    expect('error' in p).toBe(false)
  })
})

describe('parseNumstat', () => {
  test('sums insertions/deletions and keeps per-file detail', () => {
    const d = parseNumstat('12\t3\tsrc/a.ts\n0\t9\tsrc/b.ts\n')
    expect(d).toEqual({
      files: 2,
      insertions: 12,
      deletions: 12,
      perFile: [
        { path: 'src/a.ts', insertions: 12, deletions: 3 },
        { path: 'src/b.ts', insertions: 0, deletions: 9 },
      ],
    })
  })

  test('binary files (- - path) count as changed files but add no line counts', () => {
    const d = parseNumstat('-\t-\tassets/logo.png\n4\t1\tsrc/a.ts\n')
    expect(d.files).toBe(2)
    expect(d.insertions).toBe(4)
    expect(d.deletions).toBe(1)
    expect(d.perFile[0]).toEqual({
      path: 'assets/logo.png',
      insertions: 0,
      deletions: 0,
      binary: true,
    })
  })

  test('empty output is an empty diff, not a crash', () => {
    expect(parseNumstat('')).toEqual({ files: 0, insertions: 0, deletions: 0, perFile: [] })
  })
})

describe('parseJudgeVerdict', () => {
  const ids = ['e1', 'e2']

  test('extracts scores + rationales from a fenced JSON block', () => {
    const v = parseJudgeVerdict(
      'Here you go:\n```json\n{"scores":[{"id":"e2","score":8,"rationale":"tighter tests"},{"id":"e1","score":5,"rationale":"missed an edge case"}],"recommended":"e2","summary":"e2 is the stronger diff."}\n```\n',
      ids,
    )
    if ('error' in v) throw new Error(v.error)
    expect(v.recommended).toBe('e2')
    expect(v.scores.e2).toEqual({ score: 8, rationale: 'tighter tests' })
    expect(v.summary).toBe('e2 is the stronger diff.')
  })

  test('drops scores for entrants that were not in the bake-off', () => {
    const v = parseJudgeVerdict('{"scores":[{"id":"e9","score":10},{"id":"e1","score":4}]}', ids)
    if ('error' in v) throw new Error(v.error)
    expect(Object.keys(v.scores)).toEqual(['e1'])
  })

  test('ignores a recommendation that names an entrant it did not score', () => {
    const v = parseJudgeVerdict('{"scores":[{"id":"e1","score":4}],"recommended":"e2"}', ids)
    if ('error' in v) throw new Error(v.error)
    expect(v.recommended).toBeUndefined()
  })

  test('clamps out-of-range scores into 0-10', () => {
    const v = parseJudgeVerdict('{"scores":[{"id":"e1","score":99},{"id":"e2","score":-4}]}', ids)
    if ('error' in v) throw new Error(v.error)
    expect(v.scores.e1.score).toBe(10)
    expect(v.scores.e2.score).toBe(0)
  })

  test('unparseable judge output is an error, never a silent zero-score verdict', () => {
    const v = parseJudgeVerdict('I was unable to compare these diffs.', ids)
    expect('error' in v).toBe(true)
  })
})

const seed = (over: Partial<BakeOff> = {}): BakeOff => ({
  id: 'bo-test-1',
  repoRoot: '/repo',
  ticket: { id: 42, slug: '0042-thing', title: 'Do the thing', ref: '#42' },
  group: 'lane-42-abc',
  createdAt: 1,
  status: 'running',
  entrants: [
    { id: 'e1', engine: 'claude', status: 'running', runId: 'r1' },
    { id: 'e2', engine: 'codex', status: 'running', runId: 'r2' },
  ],
  ...over,
})

describe('applyRunStatuses', () => {
  test('carries run status, branch, and worktree onto the entrant', () => {
    const b = applyRunStatuses(seed(), {
      r1: { status: 'done', branch: 'agent/e1', worktree: '/wt/1' },
      r2: { status: 'running', branch: 'agent/e2', worktree: '/wt/2' },
    })
    expect(b.entrants[0]).toMatchObject({ status: 'done', branch: 'agent/e1', worktree: '/wt/1' })
    expect(b.status).toBe('running')
  })

  test('becomes ready only once every entrant has settled', () => {
    const b = applyRunStatuses(seed(), {
      r1: { status: 'done' },
      r2: { status: 'failed' },
    })
    expect(b.status).toBe('ready')
  })

  test('is failed when no entrant produced anything to compare', () => {
    const b = applyRunStatuses(seed(), { r1: { status: 'failed' }, r2: { status: 'canceled' } })
    expect(b.status).toBe('failed')
  })

  test('a decided bake-off is never dragged back to running by a late status sync', () => {
    const decided = seed({ status: 'decided', winner: { entrantId: 'e1', at: 5 } })
    const b = applyRunStatuses(decided, { r1: { status: 'done' }, r2: { status: 'running' } })
    expect(b.status).toBe('decided')
  })

  test('a missing run record leaves the entrant untouched', () => {
    const b = applyRunStatuses(seed(), { r1: { status: 'done' } })
    expect(b.entrants[1].status).toBe('running')
  })
})

describe('persistence', () => {
  beforeEach(() => {
    for (const b of listBakeOffs()) rmSync(join(ROOT, `${b.id}.json`), { force: true })
  })

  test('round-trips a bake-off through disk under the injected root', () => {
    saveBakeOff(seed())
    const got = getBakeOff('bo-test-1')
    expect(got?.ticket.title).toBe('Do the thing')
    expect(got?.entrants).toHaveLength(2)
  })

  test('listBakeOffs is newest-first and filterable by repo', () => {
    saveBakeOff(seed({ id: 'a', createdAt: 1, repoRoot: '/repo' }))
    saveBakeOff(seed({ id: 'b', createdAt: 9, repoRoot: '/other' }))
    expect(listBakeOffs().map((b) => b.id)).toEqual(['b', 'a'])
    expect(listBakeOffs('/repo').map((b) => b.id)).toEqual(['a'])
  })

  test('an unknown id reads back as null rather than throwing', () => {
    expect(getBakeOff('nope')).toBeNull()
  })
})

describe('pickWinner', () => {
  beforeEach(() => {
    for (const b of listBakeOffs()) rmSync(join(ROOT, `${b.id}.json`), { force: true })
  })

  test('the human pick decides the bake-off and is recorded as such', () => {
    saveBakeOff(seed({ status: 'ready' }))
    const r = pickWinner('bo-test-1', 'e2', 'cleaner API')
    if ('error' in r) throw new Error(r.error)
    expect(r.status).toBe('decided')
    expect(r.winner).toMatchObject({ entrantId: 'e2', note: 'cleaner API' })
    expect(getBakeOff('bo-test-1')?.winner?.entrantId).toBe('e2')
  })

  test('the human may overrule the judge, and the disagreement is recorded', () => {
    saveBakeOff(
      seed({
        status: 'ready',
        judge: {
          at: 2,
          summary: 'e1 wins',
          recommended: 'e1',
          scores: { e1: { score: 9 }, e2: { score: 3 } },
        },
      }),
    )
    const r = pickWinner('bo-test-1', 'e2')
    if ('error' in r) throw new Error(r.error)
    expect(r.winner?.agreedWithJudge).toBe(false)
  })

  test('agreement with the judge is recorded too', () => {
    saveBakeOff(
      seed({
        status: 'ready',
        judge: { at: 2, summary: 'e1 wins', recommended: 'e1', scores: {} },
      }),
    )
    const r = pickWinner('bo-test-1', 'e1')
    if ('error' in r) throw new Error(r.error)
    expect(r.winner?.agreedWithJudge).toBe(true)
  })

  test('rejects an entrant that is not in this bake-off', () => {
    saveBakeOff(seed({ status: 'ready' }))
    expect('error' in pickWinner('bo-test-1', 'e7')).toBe(true)
  })

  test('rejects a pick on an unknown bake-off', () => {
    expect('error' in pickWinner('missing', 'e1')).toBe(true)
  })
})

describe('startBakeOff', () => {
  // The spawn seam is injected, so this exercises the real fan-out wiring
  // without ever launching an engine (which would cost real money).
  const ticket = { id: 42, slug: '0042-thing', title: 'Do the thing', body: 'body' }
  const fakeRun = (id: string) => ({ id, branch: `agent/${id}`, worktree: `/wt/${id}` }) as never

  test('gives every entrant the SAME lane group and a 1-based index/total', () => {
    const seenLanes: { group: string; index: number; total: number }[] = []
    const seenEngines: string[] = []
    const b = startBakeOff(
      '/repo',
      ticket,
      [{ engine: 'claude' }, { engine: 'codex', model: 'gpt-5' }],
      allow,
      (_root, _t, e, lane) => {
        seenLanes.push(lane)
        seenEngines.push(`${e.engine}:${e.model || ''}`)
        return fakeRun(e.id)
      },
    )
    if ('error' in b) throw new Error(b.error)
    expect(new Set(seenLanes.map((l) => l.group)).size).toBe(1)
    expect(seenLanes.map((l) => l.index)).toEqual([1, 2])
    expect(seenLanes.every((l) => l.total === 2)).toBe(true)
    // The whole point: entrants differ by ENGINE, not just by attempt.
    expect(seenEngines).toEqual(['claude:', 'codex:gpt-5'])
    expect(b.entrants.map((e) => e.runId)).toEqual(['e1', 'e2'])
    expect(b.status).toBe('running')
  })

  test('a single failing entrant does not sink the bake-off', () => {
    const b = startBakeOff(
      '/repo',
      ticket,
      [{ engine: 'claude' }, { engine: 'codex' }],
      allow,
      (_r, _t, e) => (e.id === 'e1' ? { error: 'engine not installed' } : fakeRun(e.id)),
    )
    if ('error' in b) throw new Error(b.error)
    expect(b.entrants[0]).toMatchObject({ status: 'failed', error: 'engine not installed' })
    expect(b.entrants[1].status).toBe('running')
  })

  test('errors when every entrant fails to start, but still leaves a record', () => {
    const b = startBakeOff(
      '/repo',
      ticket,
      [{ engine: 'claude' }, { engine: 'codex' }],
      allow,
      () => ({ error: 'boom' }),
    )
    expect('error' in b).toBe(true)
    expect(listBakeOffs().some((x) => x.status === 'failed')).toBe(true)
  })

  // runTicketAgent shells out with execFileSync, which THROWS on a worktree
  // failure. If entrant 2 throws after entrant 1 already launched, entrant 1 is
  // burning money in a real worktree — losing the record makes it invisible.
  test('a THROWING spawn does not orphan entrants that already started', () => {
    const b = startBakeOff(
      '/repo',
      ticket,
      [{ engine: 'claude' }, { engine: 'codex' }, { engine: 'cursor' }],
      allow,
      (_r, _t, e) => {
        if (e.id === 'e2') throw new Error('git worktree add failed: already exists')
        return fakeRun(e.id)
      },
    )
    if ('error' in b) throw new Error(b.error)
    expect(b.entrants[0]).toMatchObject({ status: 'running', runId: 'e1' })
    expect(b.entrants[1].status).toBe('failed')
    expect(b.entrants[1].error).toContain('already exists')
    // e3 must still have been attempted — a throw at e2 cannot abort the loop.
    expect(b.entrants[2]).toMatchObject({ status: 'running', runId: 'e3' })
    // And the whole thing is on disk, so the started runs are discoverable.
    expect(getBakeOff(b.id)?.entrants).toHaveLength(3)
  })

  test('persists the record even when the FIRST spawn throws and a later one starts', () => {
    const b = startBakeOff(
      '/repo',
      ticket,
      [{ engine: 'claude' }, { engine: 'codex' }],
      allow,
      (_r, _t, e) => {
        if (e.id === 'e1') throw new Error('boom')
        return fakeRun(e.id)
      },
    )
    if ('error' in b) throw new Error(b.error)
    expect(getBakeOff(b.id)?.entrants[1].runId).toBe('e2')
  })

  test('never spawns anything when the budget gate refuses', () => {
    let spawned = 0
    const b = startBakeOff(
      '/repo',
      ticket,
      [{ engine: 'claude' }, { engine: 'codex' }],
      refuse,
      () => {
        spawned++
        return fakeRun('x')
      },
    )
    expect(spawned).toBe(0)
    expect('error' in b).toBe(true)
  })
})

describe('refreshBakeOffStatus', () => {
  beforeEach(() => {
    for (const b of listBakeOffs()) rmSync(join(ROOT, `${b.id}.json`), { force: true })
  })

  test('folds run status without touching git or diffs', () => {
    saveBakeOff(seed())
    const b = refreshBakeOffStatus('bo-test-1', { r1: { status: 'done' }, r2: { status: 'done' } })
    expect(b?.status).toBe('ready')
    // The polled path must never invent diff data — that is the expensive path.
    expect(b?.entrants[0].diff).toBeUndefined()
    expect(b?.entrants[0].patch).toBeUndefined()
  })

  test('is a no-op write when nothing moved', () => {
    saveBakeOff(seed())
    const first = refreshBakeOffStatus('bo-test-1', { r1: { status: 'running' } })
    const second = refreshBakeOffStatus('bo-test-1', { r1: { status: 'running' } })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  test('an unknown id is null, not a throw', () => {
    expect(refreshBakeOffStatus('nope', {})).toBeNull()
  })
})

describe('buildJudgePrompt', () => {
  test('includes the ticket, every entrant id, and its diff — but never the engine name', () => {
    const b = seed({
      entrants: [
        {
          id: 'e1',
          engine: 'claude',
          status: 'done',
          diff: { files: 1, insertions: 3, deletions: 0, perFile: [] },
          patch: 'diff --git a/x b/x\n+alpha',
        },
        {
          id: 'e2',
          engine: 'codex',
          status: 'done',
          diff: { files: 1, insertions: 4, deletions: 1, perFile: [] },
          patch: 'diff --git a/y b/y\n+beta',
        },
      ],
    })
    const p = buildJudgePrompt(b)
    expect(p).toContain('Do the thing')
    expect(p).toContain('e1')
    expect(p).toContain('+alpha')
    expect(p).toContain('+beta')
    // Blind judging: naming the engine invites brand bias in the verdict.
    expect(p).not.toContain('claude')
    expect(p).not.toContain('codex')
  })

  test('omits entrants that produced no diff', () => {
    const b = seed({
      entrants: [
        { id: 'e1', engine: 'claude', status: 'failed' },
        {
          id: 'e2',
          engine: 'codex',
          status: 'done',
          diff: { files: 1, insertions: 4, deletions: 1, perFile: [] },
          patch: 'diff --git a/y b/y\n+beta',
        },
      ],
    })
    const p = buildJudgePrompt(b)
    expect(p).not.toContain('CANDIDATE e1')
    expect(p).toContain('CANDIDATE e2')
  })
})
