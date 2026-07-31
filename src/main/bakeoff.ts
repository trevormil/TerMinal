// Cross-engine bake-off: run ONE ticket through N engines/models in parallel
// isolated worktrees, then compare the resulting diffs side by side, score them
// with a blind LLM judge, and let the human make the final pick.
//
// The spawn itself reuses the existing lane machinery (`runTicketAgent` with a
// shared lane group) — a bake-off is a lane fan-out whose lanes deliberately
// differ by engine/model instead of only by attempt. Nothing here writes to the
// ticket; lanes each open their own PR and the human's pick is recorded on the
// bake-off record, exactly as the lane contract already assumes.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentRun, Engine } from './agents'

// NOTE: no value imports from './agents' or './cheap-llm'. Both reach electron
// at module load, which would make this module (and its tests) unloadable
// outside the app. The runtime wiring is injected by src/main/ipc/bakeoff.ts;
// the judge resolves its caller lazily inside the async path.

/** Hard ceiling on parallel entrants. A bake-off is N real agent runs against
 *  real money and real CPU — the count is always explicit and user-chosen, and
 *  never silently large. */
export const MAX_ENTRANTS = 4

/** Cap on how much of each candidate patch goes to the judge, so a runaway diff
 *  can't blow the context window (or the bill). */
const PATCH_BUDGET_CHARS = 24_000

export type BakeOffEntrantSpec = { engine: Engine; model?: string; personaId?: string }

export type BakeOffDiffFile = {
  path: string
  insertions: number
  deletions: number
  binary?: boolean
}

export type BakeOffDiff = {
  files: number
  insertions: number
  deletions: number
  perFile: BakeOffDiffFile[]
}

export type BakeOffEntrantStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled'

export type BakeOffEntrant = {
  id: string
  engine: Engine
  model?: string
  personaId?: string
  status: BakeOffEntrantStatus
  runId?: string
  branch?: string
  worktree?: string
  error?: string
  diff?: BakeOffDiff
  /** Unified patch vs the merge-base, truncated. Populated on refresh. */
  patch?: string
  prUrl?: string
}

export type BakeOffJudge = {
  at: number
  summary: string
  recommended?: string
  scores: Record<string, { score: number; rationale?: string }>
  model?: string
  error?: string
}

export type BakeOff = {
  id: string
  repoRoot: string
  ticket: { id: number; slug?: string; title: string; ref: string }
  /** The lane group shared by every entrant run. */
  group: string
  createdAt: number
  status: 'running' | 'ready' | 'decided' | 'failed'
  entrants: BakeOffEntrant[]
  judge?: BakeOffJudge
  winner?: { entrantId: string; at: number; note?: string; agreedWithJudge?: boolean }
}

export type BakeOffTicketInput = {
  slug?: string
  id: number
  title: string
  body: string
  externalKey?: string
  url?: string
  comments?: unknown[]
  agent?: unknown
  modelTier?: string
}

// ---- persistence -----------------------------------------------------------

function bakeOffRoot(): string {
  return process.env.TERMINAL_BAKEOFF_ROOT || join(homedir(), '.config', 'TerMinal', 'bakeoffs')
}

function ensureRoot(): string {
  const r = bakeOffRoot()
  if (!existsSync(r)) mkdirSync(r, { recursive: true })
  return r
}

export function saveBakeOff(b: BakeOff): BakeOff {
  writeFileSync(join(ensureRoot(), `${b.id}.json`), JSON.stringify(b, null, 2))
  return b
}

export function getBakeOff(id: string): BakeOff | null {
  const f = join(bakeOffRoot(), `${id}.json`)
  if (!id || !existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as BakeOff
  } catch {
    return null
  }
}

/** Newest-first, optionally scoped to one repo. */
export function listBakeOffs(repoRoot?: string): BakeOff[] {
  const r = bakeOffRoot()
  if (!existsSync(r)) return []
  const out: BakeOff[] = []
  for (const n of readdirSync(r)) {
    if (!n.endsWith('.json')) continue
    try {
      const b = JSON.parse(readFileSync(join(r, n), 'utf8')) as BakeOff
      if (b?.id && (!repoRoot || b.repoRoot === repoRoot)) out.push(b)
    } catch {
      /* skip corrupt record */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export function deleteBakeOff(id: string): boolean {
  const f = join(bakeOffRoot(), `${id}.json`)
  if (!existsSync(f)) return false
  rmSync(f, { force: true })
  return true
}

// ---- planning --------------------------------------------------------------

/** Just the shape of budgets.gateSpawn's decision we care about — keeps this
 *  module testable without touching the real spend ledger. */
export type SpawnGate = { decision: 'allow' | 'warn' | 'refuse'; reason?: string }

export function planBakeOff(
  specs: BakeOffEntrantSpec[],
  gate: SpawnGate,
): { entrants: BakeOffEntrant[] } | { error: string } {
  const seen = new Set<string>()
  const uniq: BakeOffEntrantSpec[] = []
  for (const s of specs || []) {
    if (!s?.engine) continue
    const key = `${s.engine}::${s.model || ''}::${s.personaId || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(s)
  }
  if (uniq.length < 2) return { error: 'A bake-off needs at least 2 distinct entrants to compare.' }
  if (uniq.length > MAX_ENTRANTS)
    return { error: `A bake-off runs at most ${MAX_ENTRANTS} entrants — you chose ${uniq.length}.` }
  if (gate.decision === 'refuse')
    return { error: `Budget gate refused the bake-off: ${gate.reason || 'over cap'}` }
  return {
    entrants: uniq.map((s, i) => ({
      id: `e${i + 1}`,
      engine: s.engine,
      model: s.model,
      personaId: s.personaId,
      status: 'pending' as const,
    })),
  }
}

// ---- spawning --------------------------------------------------------------

/** Injectable so tests can exercise the fan-out without spawning real engines. */
export type SpawnLane = (
  repoRoot: string,
  ticket: BakeOffTicketInput,
  entrant: BakeOffEntrant,
  lane: { group: string; index: number; total: number },
) => AgentRun | { error: string }

export function startBakeOff(
  repoRoot: string,
  ticket: BakeOffTicketInput,
  specs: BakeOffEntrantSpec[],
  gate: SpawnGate,
  spawn: SpawnLane,
): BakeOff | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  const plan = planBakeOff(specs, gate)
  if ('error' in plan) return plan
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const group = `lane-${ticket.id}-${stamp}`
  const entrants = plan.entrants
  const total = entrants.length
  entrants.forEach((e, i) => {
    const r = spawn(repoRoot, ticket, e, { group, index: i + 1, total })
    if ('error' in r) {
      e.status = 'failed'
      e.error = r.error
    } else {
      e.status = 'running'
      e.runId = r.id
      e.branch = r.branch
      e.worktree = r.worktree
    }
  })
  if (!entrants.some((e) => e.runId))
    return { error: entrants.map((e) => `${e.id}: ${e.error}`).join('; ') || 'no entrants started' }
  return saveBakeOff({
    id: `bo-${ticket.id}-${stamp}`,
    repoRoot,
    ticket: {
      id: ticket.id,
      slug: ticket.slug,
      title: ticket.title,
      ref: ticket.externalKey || `#${ticket.id}`,
    },
    group,
    createdAt: Date.now(),
    status: 'running',
    entrants,
  })
}

// ---- status sync -----------------------------------------------------------

const SETTLED = new Set(['done', 'failed', 'canceled'])

export type RunSnapshot = { status: string; branch?: string; worktree?: string }

/** Fold live run statuses into the bake-off. Pure — the caller supplies the
 *  snapshot map so this is testable without the runs registry. */
export function applyRunStatuses(b: BakeOff, runs: Record<string, RunSnapshot>): BakeOff {
  const entrants = b.entrants.map((e) => {
    const r = e.runId ? runs[e.runId] : undefined
    if (!r) return e
    const status: BakeOffEntrantStatus = SETTLED.has(r.status)
      ? (r.status as BakeOffEntrantStatus)
      : 'running'
    return { ...e, status, branch: r.branch ?? e.branch, worktree: r.worktree ?? e.worktree }
  })
  // A human decision is terminal — a late status sync must never reopen it.
  if (b.status === 'decided') return { ...b, entrants }
  const allSettled = entrants.every((e) => SETTLED.has(e.status))
  const anyUsable = entrants.some((e) => e.status === 'done')
  const status: BakeOff['status'] = !allSettled ? 'running' : anyUsable ? 'ready' : 'failed'
  return { ...b, entrants, status }
}

// ---- diffs -----------------------------------------------------------------

export function parseNumstat(raw: string): BakeOffDiff {
  const perFile: BakeOffDiffFile[] = []
  let insertions = 0
  let deletions = 0
  for (const line of (raw || '').split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const [a, d, ...rest] = parts
    const path = rest.join('\t')
    const binary = a === '-' || d === '-'
    const ins = binary ? 0 : Number(a) || 0
    const del = binary ? 0 : Number(d) || 0
    insertions += ins
    deletions += del
    perFile.push(
      binary
        ? { path, insertions: 0, deletions: 0, binary }
        : { path, insertions: ins, deletions: del },
    )
  }
  return { files: perFile.length, insertions, deletions, perFile }
}

function git(cwd: string, args: string[], maxBuffer = 8 * 1024 * 1024): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer,
  })
}

/** The ref every lane worktree branched off — origin/HEAD when known, else
 *  main/master. Mirrors agents.ts's private defaultBase; duplicated (8 lines)
 *  rather than widening that module's export surface. */
function baseRef(repoRoot: string): string {
  try {
    return git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim()
  } catch {
    /* no origin HEAD */
  }
  for (const b of ['main', 'master']) {
    try {
      git(repoRoot, ['rev-parse', '--verify', b])
      return b
    } catch {
      /* next */
    }
  }
  return 'HEAD'
}

/** Diff an entrant's worktree against the merge-base with the repo's default
 *  branch — i.e. exactly what this entrant contributed. Returns null when the
 *  worktree is gone (the run's branch/PR still exists; the diff view degrades
 *  to stats-from-last-refresh). */
export function entrantDiff(
  repoRoot: string,
  worktree: string,
): { diff: BakeOffDiff; patch: string } | null {
  if (!worktree || !existsSync(worktree)) return null
  try {
    const base = git(worktree, ['merge-base', 'HEAD', baseRef(repoRoot)]).trim()
    // `git add -A -n` is not a thing; include working-tree changes by diffing
    // base..worktree (no ref on the right side) so uncommitted lane work counts.
    const diff = parseNumstat(git(worktree, ['diff', '--numstat', base]))
    const patch = git(worktree, ['diff', base]).slice(0, PATCH_BUDGET_CHARS)
    return { diff, patch }
  } catch {
    return null
  }
}

/** Refresh statuses AND diffs, then persist. */
export function refreshBakeOff(id: string, runs: Record<string, RunSnapshot>): BakeOff | null {
  const cur = getBakeOff(id)
  if (!cur) return null
  const next = applyRunStatuses(cur, runs)
  for (const e of next.entrants) {
    if (!e.worktree) continue
    const d = entrantDiff(next.repoRoot, e.worktree)
    if (d) {
      e.diff = d.diff
      e.patch = d.patch
    }
  }
  return saveBakeOff(next)
}

// ---- judging ---------------------------------------------------------------

/** Blind comparison prompt: candidates are labelled by entrant id ONLY. Telling
 *  the judge which engine wrote which patch invites brand bias — the whole
 *  point of the bake-off is to compare the work, not the logo. */
export function buildJudgePrompt(b: BakeOff): string {
  const candidates = b.entrants
    .filter((e) => e.patch && e.diff)
    .map(
      (e) =>
        `--- CANDIDATE ${e.id} (${e.diff!.files} files, +${e.diff!.insertions}/-${e.diff!.deletions}) ---\n${e.patch}`,
    )
    .join('\n\n')
  const ids = b.entrants.filter((e) => e.patch && e.diff).map((e) => e.id)
  return [
    `You are judging ${ids.length} independent candidate implementations of the same ticket. You do not know who or what wrote them; judge only the code.`,
    ``,
    `TICKET ${b.ticket.ref}: ${b.ticket.title}`,
    ``,
    `Score each candidate 0-10 on: does it actually satisfy the ticket, correctness and edge cases, test quality, surgical scope (no unrequested changes), and clarity. A confidently wrong or untested patch scores low no matter how large.`,
    ``,
    candidates,
    ``,
    `Reply with ONLY a JSON object, no prose:`,
    `{"scores":[{"id":"<candidate id>","score":<0-10>,"rationale":"<one sentence>"}],"recommended":"<candidate id>","summary":"<two sentences comparing them>"}`,
    `Valid candidate ids: ${ids.join(', ')}.`,
  ].join('\n')
}

export type JudgeVerdict = {
  scores: Record<string, { score: number; rationale?: string }>
  recommended?: string
  summary: string
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1), text]
  for (const c of candidates) {
    if (!c || !c.trim()) continue
    try {
      return JSON.parse(c.trim())
    } catch {
      /* next candidate */
    }
  }
  return null
}

export function parseJudgeVerdict(
  text: string,
  entrantIds: string[],
): JudgeVerdict | { error: string } {
  const raw = extractJson(text || '') as {
    scores?: unknown[]
    recommended?: unknown
    summary?: unknown
  } | null
  if (!raw || !Array.isArray(raw.scores)) return { error: 'judge did not return a scored verdict' }
  const known = new Set(entrantIds)
  const scores: JudgeVerdict['scores'] = {}
  for (const s of raw.scores) {
    const o = s as { id?: unknown; score?: unknown; rationale?: unknown }
    if (typeof o?.id !== 'string' || !known.has(o.id)) continue
    const n = Number(o.score)
    if (!Number.isFinite(n)) continue
    scores[o.id] = {
      score: Math.max(0, Math.min(10, n)),
      rationale: typeof o.rationale === 'string' ? o.rationale : undefined,
    }
  }
  if (!Object.keys(scores).length) return { error: 'judge scored none of the candidates' }
  const rec = typeof raw.recommended === 'string' ? raw.recommended : undefined
  return {
    scores,
    // A recommendation for a candidate it never scored is noise, not a verdict.
    recommended: rec && scores[rec] ? rec : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
  }
}

/** Score the bake-off with the cheap-LLM judge. Advisory ONLY — it never sets
 *  `winner`; the human still picks. */
export async function judgeBakeOff(
  id: string,
  opts: { engine?: Engine; model?: string } = {},
): Promise<BakeOff | { error: string }> {
  const b = getBakeOff(id)
  if (!b) return { error: 'bake-off not found' }
  const scorable = b.entrants.filter((e) => e.patch && e.diff)
  if (scorable.length < 2) return { error: 'need at least 2 candidate diffs to judge' }
  const { cheapCall } = await import('./cheap-llm')
  const res = await cheapCall({
    messages: [{ role: 'user', content: buildJudgePrompt(b) }],
    engine: opts.engine as never,
    model: opts.model,
    timeoutMs: 120_000,
    cwd: b.repoRoot,
  })
  if (!res.ok || !res.text) {
    return saveBakeOff({
      ...b,
      judge: { at: Date.now(), summary: '', scores: {}, error: res.error || 'judge call failed' },
    })
  }
  const v = parseJudgeVerdict(
    res.text,
    scorable.map((e) => e.id),
  )
  if ('error' in v)
    return saveBakeOff({ ...b, judge: { at: Date.now(), summary: '', scores: {}, error: v.error } })
  return saveBakeOff({
    ...b,
    judge: {
      at: Date.now(),
      summary: v.summary,
      recommended: v.recommended,
      scores: v.scores,
      model: res.model,
    },
  })
}

// ---- the human's call ------------------------------------------------------

/** The final pick is always the human's. We record whether it agreed with the
 *  judge so a later leaderboard can measure the judge, not just the engines. */
export function pickWinner(
  id: string,
  entrantId: string,
  note?: string,
): BakeOff | { error: string } {
  const b = getBakeOff(id)
  if (!b) return { error: 'bake-off not found' }
  if (!b.entrants.some((e) => e.id === entrantId))
    return { error: `no entrant "${entrantId}" in this bake-off` }
  return saveBakeOff({
    ...b,
    status: 'decided',
    winner: {
      entrantId,
      at: Date.now(),
      note: note || undefined,
      agreedWithJudge: b.judge?.recommended ? b.judge.recommended === entrantId : undefined,
    },
  })
}
