import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = mkdtempSync(join(tmpdir(), 'tm-autoreview-'))
process.env.TERMINAL_AUTOREVIEW_FILE = join(ROOT, 'pr-auto-review.json')

const {
  DEFAULT_AUTO_REVIEW,
  readAutoReviewConfig,
  writeAutoReviewConfig,
  markReviewed,
  selectAutoReviewTargets,
  runAutoReviewSweep,
} = await import('./pr-auto-review')

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

const mr = (over: Record<string, unknown> = {}) => ({
  iid: 1,
  title: 'Add a thing',
  state: 'opened',
  author: 'me',
  webUrl: 'https://example/1',
  sourceBranch: 'feat/x',
  draft: false,
  review: null,
  labels: [],
  workedBy: [],
  headShort: 'abc1234',
  ...over,
})

const cfg = (over: Record<string, unknown> = {}) => ({
  ...DEFAULT_AUTO_REVIEW,
  enabled: true,
  ...over,
})

describe('selectAutoReviewTargets', () => {
  test('picks an open, undrafted PR that has never been reviewed', () => {
    expect(selectAutoReviewTargets([mr()], {}, cfg()).map((m) => m.iid)).toEqual([1])
  })

  test('skips drafts — a draft is not asking for review yet', () => {
    expect(selectAutoReviewTargets([mr({ draft: true })], {}, cfg())).toHaveLength(0)
  })

  test('skips PRs that are not open', () => {
    expect(selectAutoReviewTargets([mr({ state: 'merged' })], {}, cfg())).toHaveLength(0)
  })

  test('skips a PR that already has a fresh review artifact — never re-reviews for free', () => {
    const reviewed = mr({ review: { verdict: 'approve', stale: false } })
    expect(selectAutoReviewTargets([reviewed], {}, cfg())).toHaveLength(0)
  })

  test('a STALE review means new commits landed, so it is eligible again', () => {
    const stale = mr({ review: { verdict: 'approve', stale: true }, headShort: 'def5678' })
    expect(selectAutoReviewTargets([stale], {}, cfg()).map((m) => m.iid)).toEqual([1])
  })

  test('does not re-fire for a head we already auto-reviewed', () => {
    expect(selectAutoReviewTargets([mr()], { '1': 'abc1234' }, cfg())).toHaveLength(0)
  })

  test('fires again once the PR is pushed to a new head', () => {
    expect(
      selectAutoReviewTargets([mr({ headShort: 'zzz9999' })], { '1': 'abc1234' }, cfg()),
    ).toHaveLength(1)
  })

  test('returns nothing at all when the feature is off (the default)', () => {
    expect(selectAutoReviewTargets([mr()], {}, DEFAULT_AUTO_REVIEW)).toHaveLength(0)
  })

  test('caps a sweep at maxPerSweep so opening five PRs cannot fan out five reviews', () => {
    const many = [1, 2, 3, 4, 5].map((iid) => mr({ iid, headShort: `sha${iid}` }))
    expect(selectAutoReviewTargets(many, {}, cfg({ maxPerSweep: 2 }))).toHaveLength(2)
  })

  test('honours an author allowlist when one is configured', () => {
    const mine = mr({ iid: 1, author: 'me' })
    const theirs = mr({ iid: 2, author: 'someone-else', headShort: 'bbb' })
    const sel = selectAutoReviewTargets([mine, theirs], {}, cfg({ authors: ['me'] }))
    expect(sel.map((m) => m.iid)).toEqual([1])
  })
})

describe('config persistence', () => {
  beforeEach(() => rmSync(process.env.TERMINAL_AUTOREVIEW_FILE!, { force: true }))

  test('defaults to DISABLED — an automatic review pass costs real money', () => {
    expect(readAutoReviewConfig().enabled).toBe(false)
  })

  test('round-trips through the injected file', () => {
    writeAutoReviewConfig({ ...DEFAULT_AUTO_REVIEW, enabled: true, maxPerSweep: 3 })
    const c = readAutoReviewConfig()
    expect(c.enabled).toBe(true)
    expect(c.maxPerSweep).toBe(3)
  })

  test('markReviewed remembers the head so the next sweep is a no-op', () => {
    markReviewed(7, 'headsha')
    expect(readAutoReviewConfig().seen['7']).toBe('headsha')
  })
})

describe('runAutoReviewSweep', () => {
  beforeEach(() => {
    rmSync(process.env.TERMINAL_AUTOREVIEW_FILE!, { force: true })
    writeAutoReviewConfig({ ...DEFAULT_AUTO_REVIEW, enabled: true })
  })

  const deps = (over: Record<string, unknown> = {}) => ({
    listMrs: async () => ({ mrs: [mr()] }),
    gate: () => ({ decision: 'allow' as const }),
    spawn: () => ({ id: 'run-1' }),
    ...over,
  })

  test('spawns one review per eligible PR and records the head', async () => {
    const spawned: number[] = []
    const r = await runAutoReviewSweep(
      '/repo',
      deps({
        spawn: (pr: { iid: number }) => {
          spawned.push(pr.iid)
          return { id: 'run-1' }
        },
      }) as never,
    )
    expect(spawned).toEqual([1])
    expect(r.started).toHaveLength(1)
    expect(readAutoReviewConfig().seen['1']).toBe('abc1234')
  })

  test('a second sweep over the same PR does nothing', async () => {
    await runAutoReviewSweep('/repo', deps() as never)
    const second = await runAutoReviewSweep('/repo', deps() as never)
    expect(second.started).toHaveLength(0)
  })

  test('a refusing budget gate spawns nothing and says why', async () => {
    let spawned = 0
    const r = await runAutoReviewSweep(
      '/repo',
      deps({
        gate: () => ({ decision: 'refuse' as const, reason: 'daily cap of $5.00 reached' }),
        spawn: () => {
          spawned++
          return { id: 'x' }
        },
      }) as never,
    )
    expect(spawned).toBe(0)
    expect(r.skipped).toMatch(/daily cap/)
    // A refused sweep must NOT mark the PR seen, or it would never be reviewed.
    expect(readAutoReviewConfig().seen['1']).toBeUndefined()
  })

  test('does nothing while disabled', async () => {
    writeAutoReviewConfig({ ...DEFAULT_AUTO_REVIEW, enabled: false })
    const r = await runAutoReviewSweep('/repo', deps() as never)
    expect(r.started).toHaveLength(0)
    expect(r.skipped).toMatch(/disabled/i)
  })

  // Storing '' and then guarding on `if (m.headShort && ...)` was falsy
  // forever: every sweep launched a fresh PAID review agent on the same PR.
  test('a PR with no resolvable head sha is auto-reviewed exactly ONCE', async () => {
    const noHead = () => ({ mrs: [mr({ headShort: '' })] })
    let spawned = 0
    const d = deps({
      listMrs: async () => noHead(),
      spawn: () => {
        spawned++
        return { id: 'run-1' }
      },
    })
    await runAutoReviewSweep('/repo', d as never)
    await runAutoReviewSweep('/repo', d as never)
    await runAutoReviewSweep('/repo', d as never)
    expect(spawned).toBe(1)
  })

  test('stamps the auto-review provenance for each PR it fires on', async () => {
    const stamped: [number, string][] = []
    await runAutoReviewSweep(
      '/repo',
      deps({ stamp: (iid: number, head: string) => stamped.push([iid, head]) }) as never,
    )
    expect(stamped).toEqual([[1, 'abc1234']])
  })

  test('does not stamp provenance for a PR whose spawn failed', async () => {
    const stamped: unknown[] = []
    await runAutoReviewSweep(
      '/repo',
      deps({
        spawn: () => ({ error: 'engine missing' }),
        stamp: (...a: unknown[]) => stamped.push(a),
      }) as never,
    )
    expect(stamped).toHaveLength(0)
  })

  test('a failed spawn is reported and does not mark the PR as reviewed', async () => {
    const r = await runAutoReviewSweep(
      '/repo',
      deps({ spawn: () => ({ error: 'engine missing' }) }) as never,
    )
    expect(r.started).toHaveLength(0)
    expect(r.errors[0]).toContain('engine missing')
    expect(readAutoReviewConfig().seen['1']).toBeUndefined()
  })
})
