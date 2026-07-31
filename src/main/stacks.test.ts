import { afterEach, describe, expect, test } from 'bun:test'
import {
  fetchStacks,
  groupStacks,
  hasStackExtension,
  isPartialStack,
  mergeStack,
  parsePullsForStacks,
  parseStackField,
  setStackRunner,
  stackExtensionInstalled,
  stackFor,
  stackMergeArgs,
  type RunResult,
  type StackedPr,
} from './stacks'

afterEach(() => setStackRunner(null))

const stackField = (over: Record<string, unknown> = {}) => ({
  base: { ref: 'main', sha: 'abc123' },
  size: 3,
  position: 1,
  id: 77,
  number: 10,
  ...over,
})

type Call = { cli: string; args: string[]; cwd: string }
function fakeRunner(result: Partial<RunResult> = {}) {
  const calls: Call[] = []
  setStackRunner(async (cli, args, cwd) => {
    calls.push({ cli, args, cwd })
    return { err: null, stdout: '', stderr: '', ...result }
  })
  return calls
}

describe('parseStackField — absence is the normal case', () => {
  test('a PR with no stack field is unstacked, not an error', () => {
    expect(parseStackField({ number: 189, title: 'x' })).toBeNull()
    expect(parseStackField({})).toBeNull()
    expect(parseStackField(null)).toBeNull()
    expect(parseStackField(undefined)).toBeNull()
  })

  test('reads the documented shape', () => {
    const s = parseStackField({ stack: stackField() })!
    expect(s.id).toBe(77)
    expect(s.size).toBe(3)
    expect(s.position).toBe(1)
    expect(s.base).toEqual({ ref: 'main', sha: 'abc123' })
  })

  test('a half-populated preview payload is treated as unstacked', () => {
    // Rendering half a stack as a real stack is worse than rendering none.
    expect(parseStackField({ stack: stackField({ id: undefined }) })).toBeNull()
    expect(parseStackField({ stack: stackField({ position: undefined }) })).toBeNull()
    expect(parseStackField({ stack: stackField({ size: undefined }) })).toBeNull()
    expect(parseStackField({ stack: stackField({ base: undefined }) })).toBeNull()
    expect(parseStackField({ stack: stackField({ base: { sha: 'x' } }) })).toBeNull()
  })

  test('nonsensical sizes and positions are rejected', () => {
    expect(parseStackField({ stack: stackField({ size: 0 }) })).toBeNull()
    expect(parseStackField({ stack: stackField({ position: 0 }) })).toBeNull()
    expect(parseStackField({ stack: stackField({ size: Number.NaN }) })).toBeNull()
  })

  test('a missing base sha is tolerated — only ref is load-bearing', () => {
    const s = parseStackField({ stack: stackField({ base: { ref: 'main' } }) })!
    expect(s.base.sha).toBe('')
  })

  test('a stack field of the wrong type never throws', () => {
    expect(parseStackField({ stack: 'yes' })).toBeNull()
    expect(parseStackField({ stack: 42 })).toBeNull()
  })
})

describe('groupStacks', () => {
  const pr = (iid: number, over: Record<string, unknown> = {}): StackedPr => ({
    iid,
    stack: parseStackField({ stack: stackField(over) }),
  })

  test('groups by stack id and orders layers bottom-to-top by position', () => {
    const stacks = groupStacks([
      pr(12, { position: 3 }),
      pr(10, { position: 1 }),
      pr(11, { position: 2 }),
    ])
    expect(stacks).toHaveLength(1)
    expect(stacks[0].layers.map((l) => l.iid)).toEqual([10, 11, 12])
    expect(stacks[0].baseRef).toBe('main')
    expect(stacks[0].size).toBe(3)
  })

  test('separate stacks stay separate', () => {
    const stacks = groupStacks([
      pr(10, { id: 1, position: 1, size: 1 }),
      pr(20, { id: 2, position: 1, size: 2 }),
      pr(21, { id: 2, position: 2, size: 2 }),
    ])
    expect(stacks.map((s) => s.id)).toEqual([1, 2])
    expect(stacks[1].layers.map((l) => l.iid)).toEqual([20, 21])
  })

  test('unstacked PRs produce no stack at all', () => {
    expect(groupStacks([{ iid: 189, stack: null }, pr(10)])).toHaveLength(1)
    expect(groupStacks([{ iid: 189, stack: null }])).toEqual([])
  })

  test('a duplicate position keeps the first layer rather than corrupting the map', () => {
    const stacks = groupStacks([pr(10, { position: 1 }), pr(11, { position: 1 })])
    expect(stacks[0].layers.map((l) => l.iid)).toEqual([10])
  })

  test('trusts the largest reported size when layers disagree', () => {
    const stacks = groupStacks([pr(10, { position: 1, size: 2 }), pr(11, { position: 2, size: 4 })])
    expect(stacks[0].size).toBe(4)
  })
})

describe('stackFor / isPartialStack', () => {
  const stacks = groupStacks([
    { iid: 10, stack: parseStackField({ stack: stackField({ position: 1, size: 3 }) }) },
    { iid: 11, stack: parseStackField({ stack: stackField({ position: 2, size: 3 }) }) },
  ])

  test('finds the stack a PR belongs to', () => {
    expect(stackFor(stacks, 11)?.id).toBe(77)
  })

  test('an unstacked PR resolves to null', () => {
    expect(stackFor(stacks, 189)).toBeNull()
    expect(stackFor([], 10)).toBeNull()
  })

  test('a stack we only partly fetched is flagged, not silently drawn short', () => {
    expect(isPartialStack(stacks[0])).toBe(true)
  })

  test('a fully fetched stack is not partial', () => {
    const full = groupStacks([
      { iid: 10, stack: parseStackField({ stack: stackField({ position: 1, size: 2 }) }) },
      { iid: 11, stack: parseStackField({ stack: stackField({ position: 2, size: 2 }) }) },
    ])
    expect(isPartialStack(full[0])).toBe(false)
  })
})

describe('merge call shape', () => {
  test('merging a stack uses the stack command, never per-PR merges', () => {
    const args = stackMergeArgs(42)
    expect(args).toEqual(['stack', 'merge', '42'])
    // The failure this guards against: a loop of `gh pr merge`, which has
    // different semantics and cannot cascade the stack.
    expect(args).not.toContain('pr')
  })

  test('mergeStack shells exactly one stack merge, not one call per layer', async () => {
    const calls = fakeRunner()
    const r = await mergeStack('/repo', 42)
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ cli: 'gh', args: ['stack', 'merge', '42'], cwd: '/repo' })
  })

  test('a merge failure surfaces the first stderr line, never throws', async () => {
    fakeRunner({ err: new Error('exit 1'), stderr: 'stack is not mergeable\ndetail' })
    expect(await mergeStack('/repo', 42)).toEqual({
      ok: false,
      error: 'stack is not mergeable',
    })
  })
})

describe('extension probe', () => {
  test('detects the official extension in gh output', () => {
    expect(hasStackExtension('gh stack\tgithub/gh-stack\tv1.0.0')).toBe(true)
    expect(hasStackExtension('gh dash\tdlvhdr/gh-dash\tv4')).toBe(false)
    expect(hasStackExtension('')).toBe(false)
  })

  test('a failing probe reads as not installed rather than throwing', async () => {
    fakeRunner({ err: new Error('gh: not found') })
    expect(await stackExtensionInstalled('/repo')).toBe(false)
  })

  test('a successful probe listing the extension reads as installed', async () => {
    fakeRunner({ stdout: 'gh stack\tgithub/gh-stack\tv1.0.0' })
    expect(await stackExtensionInstalled('/repo')).toBe(true)
  })
})

describe('parsePullsForStacks / fetchStacks', () => {
  test('mixes stacked and unstacked PRs from one payload', () => {
    const rows = parsePullsForStacks(
      JSON.stringify([
        { number: 10, stack: stackField({ position: 1 }) },
        { number: 189 }, // real-world: a plain PR has no stack field at all
      ]),
    )
    expect(rows.map((r) => r.iid)).toEqual([10, 189])
    expect(rows[1].stack).toBeNull()
  })

  test('malformed JSON or a non-array payload yields no rows, never throws', () => {
    expect(parsePullsForStacks('{oops')).toEqual([])
    expect(parsePullsForStacks('{"message":"Not Found"}')).toEqual([])
    expect(parsePullsForStacks('')).toEqual([])
  })

  test('a repo where the preview has not rolled out yields zero stacks', async () => {
    fakeRunner({ stdout: JSON.stringify([{ number: 1 }, { number: 2 }]) })
    expect(await fetchStacks('/repo', 'o/r')).toEqual({ stacks: [] })
  })

  test('a gh failure degrades to no stacks plus a reason', async () => {
    fakeRunner({ err: new Error('boom'), stderr: 'gh: not authenticated\nmore' })
    const r = await fetchStacks('/repo', 'o/r')
    expect(r.stacks).toEqual([])
    expect(r.error).toBe('gh: not authenticated')
  })

  test('does not shell out at all without a repo path', async () => {
    const calls = fakeRunner()
    expect(await fetchStacks('/repo', '')).toEqual({ stacks: [] })
    expect(calls).toHaveLength(0)
  })

  test('queries only open PRs', async () => {
    const calls = fakeRunner({ stdout: '[]' })
    await fetchStacks('/repo', 'o/r')
    expect(calls[0].args[1]).toContain('state=open')
  })
})
