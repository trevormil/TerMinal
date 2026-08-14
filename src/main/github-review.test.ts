import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import {
  shapeCheckRuns,
  summarizeChecks,
  summariesFromPrList,
  shapeConversation,
  reviewCliArgs,
  CONVERSATION_QUERY,
} from './github-review'
import { setForgeRunForTests } from './forge'

beforeEach(() => setForgeRunForTests(null))
afterEach(() => setForgeRunForTests(null))

// ── fixtures ────────────────────────────────────────────────────────────────
// Trimmed to the fields the shaper reads, but keeping GitHub's real spelling
// (snake_case REST, camelCase GraphQL) — a shaper tested against a fixture in
// the wrong casing passes and then returns empty rows against the real API.

const CHECK_RUNS_JSON = JSON.stringify({
  total_count: 4,
  check_runs: [
    {
      id: 101,
      name: 'unit',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-08-14T10:00:00Z',
      completed_at: '2026-08-14T10:01:30Z',
      details_url: 'https://github.com/o/r/runs/101',
    },
    {
      id: 102,
      name: 'typecheck',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2026-08-14T10:00:00Z',
      completed_at: '2026-08-14T10:00:20Z',
      html_url: 'https://github.com/o/r/runs/102',
    },
    {
      id: 103,
      name: 'e2e',
      status: 'in_progress',
      conclusion: null,
      started_at: '2026-08-14T10:00:00Z',
      completed_at: null,
      details_url: '',
    },
    {
      id: 104,
      name: 'docs',
      status: 'completed',
      conclusion: 'skipped',
      started_at: null,
      completed_at: null,
      details_url: '',
    },
  ],
})

const COMBINED_STATUS_JSON = JSON.stringify({
  state: 'failure',
  statuses: [
    {
      context: 'ci/deploy',
      state: 'failure',
      target_url: 'https://ci.example/deploy',
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:02:00Z',
    },
    {
      context: 'license/cla',
      state: 'success',
      target_url: 'https://cla.example',
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:05Z',
    },
  ],
})

const GRAPHQL_JSON = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewDecision: 'CHANGES_REQUESTED',
        reviewRequests: {
          nodes: [
            { requestedReviewer: { login: 'carol', avatarUrl: 'https://a/carol.png' } },
            { requestedReviewer: { name: 'platform-team' } },
            { requestedReviewer: null },
          ],
        },
        comments: {
          nodes: [
            {
              id: 'IC_1',
              databaseId: 9001,
              author: { login: 'alice', avatarUrl: 'https://a/alice.png' },
              body: 'Top level note',
              createdAt: '2026-08-14T09:00:00Z',
              url: 'https://github.com/o/r/pull/7#issuecomment-9001',
            },
          ],
        },
        reviews: {
          nodes: [
            {
              id: 'PRR_1',
              author: { login: 'bob', avatarUrl: 'https://a/bob.png' },
              state: 'COMMENTED',
              body: 'first pass',
              createdAt: '2026-08-14T09:10:00Z',
              url: 'https://github.com/o/r/pull/7#pullrequestreview-1',
            },
            {
              id: 'PRR_2',
              author: { login: 'bob', avatarUrl: 'https://a/bob.png' },
              state: 'CHANGES_REQUESTED',
              body: 'needs work',
              createdAt: '2026-08-14T09:20:00Z',
              url: 'https://github.com/o/r/pull/7#pullrequestreview-2',
            },
            {
              id: 'PRR_3',
              author: { login: 'dave', avatarUrl: 'https://a/dave.png' },
              state: 'PENDING',
              body: '',
              createdAt: '2026-08-14T09:30:00Z',
              url: '',
            },
          ],
        },
        reviewThreads: {
          nodes: [
            {
              id: 'PRRT_1',
              isResolved: false,
              isOutdated: false,
              path: 'src/main/forge.ts',
              line: 42,
              diffSide: 'RIGHT',
              comments: {
                nodes: [
                  {
                    id: 'PRRC_1',
                    databaseId: 5001,
                    author: { login: 'bob', avatarUrl: 'https://a/bob.png' },
                    body: 'this leaks',
                    createdAt: '2026-08-14T09:21:00Z',
                    url: 'https://github.com/o/r/pull/7#discussion_r5001',
                  },
                  {
                    id: 'PRRC_2',
                    databaseId: 5002,
                    author: { login: 'alice', avatarUrl: 'https://a/alice.png' },
                    body: 'fixed',
                    createdAt: '2026-08-14T09:25:00Z',
                    url: 'https://github.com/o/r/pull/7#discussion_r5002',
                  },
                ],
              },
            },
            {
              id: 'PRRT_2',
              isResolved: true,
              isOutdated: true,
              path: 'README.md',
              line: null,
              diffSide: 'LEFT',
              comments: { nodes: [] },
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              __typename: 'PullRequestCommit',
              commit: {
                abbreviatedOid: 'abc1234',
                messageHeadline: 'feat: add thing',
                committedDate: '2026-08-14T08:00:00Z',
                author: { user: { login: 'alice' }, name: 'Alice' },
              },
            },
            {
              __typename: 'HeadRefForcePushedEvent',
              actor: { login: 'alice' },
              createdAt: '2026-08-14T08:30:00Z',
              beforeCommit: { abbreviatedOid: 'aaa1111' },
              afterCommit: { abbreviatedOid: 'bbb2222' },
            },
            { __typename: 'SomethingElse' },
          ],
        },
      },
    },
  },
})

// ── checks ──────────────────────────────────────────────────────────────────

describe('shapeCheckRuns', () => {
  test('merges check-runs and legacy commit statuses into one list', () => {
    const runs = shapeCheckRuns(CHECK_RUNS_JSON, COMBINED_STATUS_JSON)
    expect(runs.map((r) => r.name).sort()).toEqual([
      'ci/deploy',
      'docs',
      'e2e',
      'license/cla',
      'typecheck',
      'unit',
    ])
    expect(
      runs
        .filter((r) => r.source === 'status')
        .map((r) => r.name)
        .sort(),
    ).toEqual(['ci/deploy', 'license/cla'])
  })

  test('failed checks come first, then pending, then the rest', () => {
    const runs = shapeCheckRuns(CHECK_RUNS_JSON, COMBINED_STATUS_JSON)
    // The two failures lead; the in-progress e2e is next; successes/skips trail.
    expect(
      runs
        .slice(0, 2)
        .map((r) => r.name)
        .sort(),
    ).toEqual(['ci/deploy', 'typecheck'])
    expect(runs[2].name).toBe('e2e')
    expect(runs.at(-1)?.conclusion).not.toBe('failure')
  })

  test('duration is wall time, and null when the run has not finished', () => {
    const runs = shapeCheckRuns(CHECK_RUNS_JSON, '')
    const unit = runs.find((r) => r.name === 'unit')!
    expect(unit.durationMs).toBe(90_000)
    expect(runs.find((r) => r.name === 'e2e')!.durationMs).toBeNull()
    expect(runs.find((r) => r.name === 'docs')!.durationMs).toBeNull()
  })

  test('details url falls back to html_url, and a status uses target_url', () => {
    const runs = shapeCheckRuns(CHECK_RUNS_JSON, COMBINED_STATUS_JSON)
    expect(runs.find((r) => r.name === 'typecheck')!.detailsUrl).toBe(
      'https://github.com/o/r/runs/102',
    )
    expect(runs.find((r) => r.name === 'ci/deploy')!.detailsUrl).toBe('https://ci.example/deploy')
  })

  test('a legacy status maps state → status/conclusion in check-run vocabulary', () => {
    const runs = shapeCheckRuns('', COMBINED_STATUS_JSON)
    const pending = shapeCheckRuns(
      '',
      JSON.stringify({ statuses: [{ context: 'slow', state: 'pending' }] }),
    )[0]
    expect(runs.find((r) => r.name === 'license/cla')).toMatchObject({
      status: 'completed',
      conclusion: 'success',
    })
    expect(pending).toMatchObject({ status: 'in_progress', conclusion: '' })
  })

  test('unparseable or absent payloads yield an empty list, never a throw', () => {
    expect(shapeCheckRuns('', '')).toEqual([])
    expect(shapeCheckRuns('not json', '{')).toEqual([])
    expect(shapeCheckRuns('{"check_runs":null}', '{"statuses":"nope"}')).toEqual([])
  })
})

describe('summarizeChecks', () => {
  test('counts each bucket and picks the worst state', () => {
    const s = summarizeChecks(shapeCheckRuns(CHECK_RUNS_JSON, COMBINED_STATUS_JSON))
    expect(s).toEqual({ passed: 2, failed: 2, pending: 1, other: 1, total: 6, state: 'failed' })
  })

  test('pending outranks success but loses to failure', () => {
    expect(
      summarizeChecks(shapeCheckRuns('{"check_runs":[{"name":"a","status":"queued"}]}', '')).state,
    ).toBe('pending')
    expect(
      summarizeChecks(
        shapeCheckRuns(
          '{"check_runs":[{"name":"a","status":"completed","conclusion":"success"}]}',
          '',
        ),
      ).state,
    ).toBe('success')
  })

  test('no checks at all is `none`, not `success`', () => {
    // "Nothing ran" and "everything passed" are different facts; a green chip
    // over a repo with no CI is a lie the reviewer acts on.
    expect(summarizeChecks([]).state).toBe('none')
  })

  test('cancelled / timed_out / action_required count as failures', () => {
    const runs = shapeCheckRuns(
      JSON.stringify({
        check_runs: [
          { name: 'a', status: 'completed', conclusion: 'cancelled' },
          { name: 'b', status: 'completed', conclusion: 'timed_out' },
          { name: 'c', status: 'completed', conclusion: 'action_required' },
        ],
      }),
      '',
    )
    expect(summarizeChecks(runs).failed).toBe(3)
  })
})

describe('summariesFromPrList', () => {
  const LIST = JSON.stringify([
    {
      number: 7,
      statusCheckRollup: [
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
        { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null },
        { __typename: 'StatusContext', state: 'SUCCESS' },
      ],
    },
    { number: 8, statusCheckRollup: [] },
    { number: 9 },
  ])

  test('one entry per PR, keyed by number', () => {
    const r = summariesFromPrList(LIST)
    expect(Object.keys(r).map(Number).sort()).toEqual([7, 8, 9])
  })

  test('rollup counts match the per-PR checks summary vocabulary', () => {
    expect(summariesFromPrList(LIST)[7]).toEqual({
      passed: 2,
      failed: 1,
      pending: 1,
      other: 0,
      total: 4,
      state: 'failed',
    })
  })

  test('a PR with no rollup is `none`, and never crashes the map', () => {
    expect(summariesFromPrList(LIST)[8].state).toBe('none')
    expect(summariesFromPrList(LIST)[9].total).toBe(0)
  })

  test('garbage in → empty map', () => {
    expect(summariesFromPrList('nope')).toEqual({})
    expect(summariesFromPrList('{"not":"an array"}')).toEqual({})
  })
})

// ── conversation ────────────────────────────────────────────────────────────

describe('shapeConversation', () => {
  test('carries the review decision through', () => {
    expect(shapeConversation(GRAPHQL_JSON).reviewDecision).toBe('CHANGES_REQUESTED')
  })

  test('reviewers collapse to the latest opinion per author, requested reviewers appended', () => {
    const { reviewers } = shapeConversation(GRAPHQL_JSON)
    const byLogin = Object.fromEntries(reviewers.map((r) => [r.login, r.state]))
    // bob reviewed twice — CHANGES_REQUESTED is the standing one, not COMMENTED.
    expect(byLogin.bob).toBe('CHANGES_REQUESTED')
    expect(byLogin.carol).toBe('REQUESTED')
    // A PENDING review is an unsubmitted draft — it is nobody's standing state.
    expect(byLogin.dave).toBeUndefined()
    expect(reviewers.find((r) => r.login === 'bob')!.avatarUrl).toBe('https://a/bob.png')
  })

  test('a requested team reviewer does not become a nameless user row', () => {
    const { reviewers } = shapeConversation(GRAPHQL_JSON)
    expect(reviewers.some((r) => r.login === 'platform-team')).toBe(true)
    expect(reviewers.some((r) => !r.login)).toBe(false)
  })

  test('issue comments and review submissions stay separate', () => {
    const c = shapeConversation(GRAPHQL_JSON)
    expect(c.comments.map((x) => x.body)).toEqual(['Top level note'])
    expect(c.comments[0].databaseId).toBe(9001)
    // The empty-bodied PENDING draft is dropped; the two real submissions stay.
    expect(c.reviews.map((r) => r.state)).toEqual(['COMMENTED', 'CHANGES_REQUESTED'])
  })

  test('threads keep file/line context, resolution, and a reply target', () => {
    const [t1, t2] = shapeConversation(GRAPHQL_JSON).threads
    expect(t1).toMatchObject({
      path: 'src/main/forge.ts',
      line: 42,
      diffSide: 'RIGHT',
      resolved: false,
      replyToId: 5001,
    })
    expect(t1.comments.map((c) => c.login)).toEqual(['bob', 'alice'])
    expect(t2).toMatchObject({ resolved: true, outdated: true, line: null, replyToId: null })
  })

  test('force-push and commit markers are extracted, unknown timeline items ignored', () => {
    const { markers } = shapeConversation(GRAPHQL_JSON)
    expect(markers.map((m) => m.kind)).toEqual(['commit', 'force-push'])
    expect(markers[0]).toMatchObject({ actor: 'alice', oid: 'abc1234', detail: 'feat: add thing' })
    expect(markers[1].detail).toBe('aaa1111 → bbb2222')
  })

  test('a GraphQL error payload shapes to empty rather than throwing', () => {
    const errored = shapeConversation('{"errors":[{"message":"Could not resolve"}],"data":null}')
    expect(errored.reviewDecision).toBe('')
    expect(errored.reviewers).toEqual([])
    expect(errored.threads).toEqual([])
    expect(shapeConversation('').comments).toEqual([])
  })
})

describe('CONVERSATION_QUERY', () => {
  test('asks for every field the shaper reads', () => {
    // The shaper and the query drift apart silently — the shaper just returns
    // empty. Pin the field names in the query text.
    for (const field of [
      'reviewDecision',
      'reviewRequests',
      'reviewThreads',
      'timelineItems',
      'databaseId',
      'isResolved',
      'HeadRefForcePushedEvent',
      'PullRequestCommit',
    ])
      expect(CONVERSATION_QUERY).toContain(field)
  })
})

// ── review actions ──────────────────────────────────────────────────────────

describe('reviewCliArgs', () => {
  test('each event maps to its gh flag, body passed as one argument', () => {
    expect(reviewCliArgs(7, 'approve', 'lgtm')).toEqual([
      'pr',
      'review',
      '7',
      '--approve',
      '--body',
      'lgtm',
    ])
    expect(reviewCliArgs(7, 'request-changes', 'no')).toEqual([
      'pr',
      'review',
      '7',
      '--request-changes',
      '--body',
      'no',
    ])
    expect(reviewCliArgs(7, 'comment', 'hm')).toEqual([
      'pr',
      'review',
      '7',
      '--comment',
      '--body',
      'hm',
    ])
  })

  test('an approval with no body omits --body instead of sending an empty one', () => {
    // `gh pr review --approve --body ''` is rejected by gh; a bodyless approve
    // is the common case and must not surface as an error.
    expect(reviewCliArgs(7, 'approve', '   ')).toEqual(['pr', 'review', '7', '--approve'])
  })

  test('a body that looks like a flag is still a body, not an option', () => {
    // Passed positionally after --body, execFile never re-parses it — assert the
    // shape so nobody "helpfully" collapses it into `--body=<text>`.
    expect(reviewCliArgs(7, 'comment', '--repo evil/repo')).toEqual([
      'pr',
      'review',
      '7',
      '--comment',
      '--body',
      '--repo evil/repo',
    ])
  })
})
