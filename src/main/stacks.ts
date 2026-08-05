// GitHub native stacked pull requests (ticket #0095).
//
// GitHub shipped stacked PRs as a public preview on 2026-07-30. A PR object now
// carries an optional `stack` field; a PR that is not in a stack simply has no
// such field, and the feature is still rolling out repo by repo. So the entire
// module is written around one rule: **absence is the normal case**. Everything
// degrades to exactly the pre-stack rendering when `stack` is missing.
//
// Deliberately separate from forge.ts / mrs.ts (owned elsewhere) — this module
// only reads, via `gh`, and exposes pure shaping functions for the renderer.

import { execFile } from 'node:child_process'
import { ghEnvFor } from './repo'

/** The `stack` field on a GitHub pull request object. Field names and shape are
 *  taken verbatim from the REST pulls docs — see the ticket's verified spec. */
export type PrStack = {
  base: { ref: string; sha: string }
  size: number
  position: number
  id: number
  number: number
}

/** One PR as far as stacking is concerned. */
export type StackedPr = {
  iid: number
  stack: PrStack | null
}

/** A resolved stack: its layers in bottom-to-top order. */
export type Stack = {
  id: number
  size: number
  /** Base branch the whole stack lands on. */
  baseRef: string
  layers: { iid: number; position: number }[]
}

// --- pure shaping ------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Read the `stack` field off a raw PR object, or null.
 *
 * Strict on purpose: a preview API that is still rolling out is exactly the
 * place where a half-populated object shows up, and half a stack rendered as a
 * real stack is worse than no stack at all. Anything missing `id`, `position`,
 * `size`, or `base.ref` is treated as unstacked.
 */
export function parseStackField(raw: unknown): PrStack | null {
  const s = (raw as { stack?: unknown })?.stack as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object') return null
  const base = s.base as { ref?: unknown; sha?: unknown } | undefined
  if (!base || typeof base.ref !== 'string' || !base.ref) return null
  if (!isFiniteNumber(s.id) || !isFiniteNumber(s.position) || !isFiniteNumber(s.size)) return null
  if (s.size < 1 || s.position < 1) return null
  return {
    base: { ref: base.ref, sha: typeof base.sha === 'string' ? base.sha : '' },
    size: s.size,
    position: s.position,
    id: s.id,
    number: isFiniteNumber(s.number) ? s.number : 0,
  }
}

/**
 * Group PRs into stacks, layers ordered bottom-to-top by `position`.
 *
 * A PR belongs to exactly one stack and stacks are linear chains, so `id` is a
 * sufficient grouping key and `position` is a total order within it.
 * Unstacked PRs produce no stack — they are simply absent from the result.
 */
export function groupStacks(prs: StackedPr[]): Stack[] {
  const byId = new Map<number, Stack>()
  for (const pr of prs) {
    if (!pr.stack) continue
    const { id, size, position, base } = pr.stack
    let stack = byId.get(id)
    if (!stack) {
      stack = { id, size, baseRef: base.ref, layers: [] }
      byId.set(id, stack)
    }
    // A duplicate position would mean two PRs claiming the same layer; keep the
    // first and ignore the second rather than rendering a corrupt map.
    if (stack.layers.some((l) => l.position === position)) continue
    stack.layers.push({ iid: pr.iid, position })
    // Trust the largest reported size: a partially-fetched stack under-reports.
    if (size > stack.size) stack.size = size
  }
  for (const stack of byId.values()) stack.layers.sort((a, b) => a.position - b.position)
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

/** The stack containing a PR, or null when it is not stacked. */
export function stackFor(stacks: Stack[], iid: number): Stack | null {
  return stacks.find((s) => s.layers.some((l) => l.iid === iid)) ?? null
}

/** True when we fetched fewer layers than GitHub says the stack has. The UI
 *  says so rather than silently drawing an incomplete map. */
export function isPartialStack(stack: Stack): boolean {
  return stack.layers.length < stack.size
}

/**
 * argv for merging a stack up to and including `iid`.
 *
 * MUST go through the stack merge path, never a loop of `gh pr merge`: the
 * dedicated async endpoint merges every PR in the stack up to and including the
 * requested one as a single cascading operation, and per-PR merges have
 * different semantics and cannot cascade.
 */
export function stackMergeArgs(iid: number): string[] {
  return ['stack', 'merge', String(iid)]
}

/** argv for the extension probe — `gh stack` is an extension, not built in. */
export function stackExtensionProbeArgs(): string[] {
  return ['extension', 'list']
}

/** Does `gh extension list` output show the official stack extension? */
export function hasStackExtension(stdout: string): boolean {
  return /github\/gh-stack/i.test(stdout || '')
}

// --- gh access ---------------------------------------------------------------

export type RunResult = { err: Error | null; stdout: string; stderr: string }
type Runner = (cli: string, args: string[], cwd: string) => Promise<RunResult>

const defaultRunner: Runner = (cli, args, cwd) =>
  new Promise((resolve) =>
    execFile(
      cli,
      args,
      {
        cwd,
        env: cli === 'gh' ? ghEnvFor(cwd) : undefined, // survive url.*.insteadOf
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }),
    ),
  )

let runner: Runner = defaultRunner

/** Swap the process runner (tests). */
export function setStackRunner(fn: Runner | null): void {
  runner = fn ?? defaultRunner
}

/** Parse `gh api .../pulls` output into stack-relevant rows. Never throws. */
export function parsePullsForStacks(stdout: string): StackedPr[] {
  try {
    const arr = JSON.parse(stdout)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((p) => isFiniteNumber(p?.number))
      .map((p) => ({ iid: Number(p.number), stack: parseStackField(p) }))
  } catch {
    return []
  }
}

/**
 * Fetch the open PRs of `repoPath` (owner/name) and resolve their stacks.
 *
 * Any failure — `gh` missing, not authenticated, a repo where the preview has
 * not rolled out, an older `gh` that does not surface the field — yields an
 * empty stack list, which renders exactly as today.
 */
export async function fetchStacks(
  repoRoot: string,
  repoPath: string,
): Promise<{ stacks: Stack[]; error?: string }> {
  if (!repoRoot || !repoPath) return { stacks: [] }
  const r = await runner('gh', ['api', `repos/${repoPath}/pulls?state=open&per_page=100`], repoRoot)
  if (r.err) return { stacks: [], error: (r.stderr || r.err.message || 'gh error').split('\n')[0] }
  return { stacks: groupStacks(parsePullsForStacks(r.stdout)) }
}

/** Is the official `gh stack` extension installed? */
export async function stackExtensionInstalled(repoRoot: string): Promise<boolean> {
  const r = await runner('gh', stackExtensionProbeArgs(), repoRoot)
  return !r.err && hasStackExtension(r.stdout)
}

/**
 * Merge a stack up to and including `iid`.
 *
 * Never called by an agent — this is behind the app's human merge gate, same as
 * the single-PR merge button. The CLAUDE.md §8 bar applies to every layer this
 * cascades through and is applied by the human, who reads each layer's
 * readiness badge in the stack map before confirming.
 */
export async function mergeStack(
  repoRoot: string,
  iid: number,
): Promise<{ ok: boolean; error?: string }> {
  const r = await runner('gh', stackMergeArgs(iid), repoRoot)
  if (r.err)
    return { ok: false, error: (r.stderr || r.err.message || 'stack merge failed').split('\n')[0] }
  return { ok: true }
}
