// Read-only history for a loop's on-disk state.
//
// The live cockpit widget reads LoopState — a deliberately bounded snapshot. A
// *finished* loop needs the opposite: the whole audit trail, which is what makes
// past loops inspectable after the session that ran them is gone.
//
// Kept separate from loops.ts (and dependency-free, like loop-decide.ts) for two
// reasons: loops.ts pulls in electron transitively, and these readers take an
// explicit directory so they are exercised against a temp dir rather than any
// real state under ~/.config/TerMinal.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type LoopScore = { file: string; iteration: number; weighted: number | null }

export type LoopTurn = {
  file: string
  iteration: number
  role: string
  runId: string
  bytes: number
}

export type PlateauInfo = {
  plateaued: boolean
  /** Scored turns since the best score. */
  sinceImprovement: number
  best: number | null
}

export type LoopHistory = {
  contract: string
  progress: string
  log: string
  scores: LoopScore[]
  turns: LoopTurn[]
  assertions: { total: number; pass: number; fail: number; todo: number }
  plateau: PlateauInfo
}

/**
 * `weighted: 0.82` out of an evaluator score file. null (not 0) when absent.
 * The leading boundary is load-bearing: score files also carry an
 * `unweighted:` line, which a bare substring match reads instead.
 */
export function parseScoreValue(md: string): number | null {
  const m = md.match(/(?:^|\s)weighted:\s*([0-9]*\.?[0-9]+)/m)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * Has taste stopped improving? Measured as scored turns since the *best* score,
 * so a regression after a peak still counts as stalled — the case the existing
 * "did the last two scores differ" check in stepLoop misses.
 */
export function detectPlateau(values: number[], window = 3, epsilon = 0.02): PlateauInfo {
  if (values.length === 0) return { plateaued: false, sinceImprovement: 0, best: null }
  let best = values[0]
  let bestIdx = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i] > best + epsilon) {
      best = values[i]
      bestIdx = i
    } else if (values[i] > best) {
      // Within epsilon: keep the higher number for display, but noise is not
      // progress, so it does not reset the stall counter.
      best = values[i]
    }
  }
  const sinceImprovement = values.length - 1 - bestIdx
  return {
    plateaued: values.length > window && sinceImprovement >= window,
    sinceImprovement,
    best,
  }
}

const readIfExists = (p: string): string => {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  } catch {
    return ''
  }
}

/** Leading integer of a state filename (`12-evaluator-ab3.log` -> 12). */
const leadingNum = (f: string): number => {
  const n = parseInt(f.match(/^(\d+)/)?.[1] || '', 10)
  return Number.isFinite(n) ? n : 0
}

export function readLoopHistoryAt(dir: string): LoopHistory {
  const scores: LoopScore[] = []
  try {
    for (const f of readdirSync(join(dir, 'scores')).filter((n) => n.endsWith('.md'))) {
      scores.push({
        file: f,
        iteration: leadingNum(f),
        weighted: parseScoreValue(readIfExists(join(dir, 'scores', f))),
      })
    }
  } catch {
    /* no scores yet */
  }
  // Numeric, not lexicographic — otherwise turn 10 sorts before turn 2 and the
  // trend line is scrambled.
  scores.sort((a, b) => a.iteration - b.iteration || a.file.localeCompare(b.file))

  const turns: LoopTurn[] = []
  try {
    for (const f of readdirSync(join(dir, 'turns'))) {
      const m = f.match(/^(\d+)-([a-z]+)-(.+)\.log$/)
      let bytes = 0
      try {
        bytes = statSync(join(dir, 'turns', f)).size
      } catch {
        /* ignore */
      }
      turns.push({
        file: f,
        iteration: leadingNum(f),
        role: m?.[2] || '',
        runId: m?.[3] || '',
        bytes,
      })
    }
  } catch {
    /* no turns yet */
  }
  turns.sort((a, b) => a.iteration - b.iteration || a.file.localeCompare(b.file))

  const counts = { total: 0, pass: 0, fail: 0, todo: 0 }
  try {
    const fl = JSON.parse(readIfExists(join(dir, 'feature_list.json')) || '{}')
    for (const a of fl.assertions || []) {
      counts.total++
      if (a.status === 'pass') counts.pass++
      else if (a.status === 'fail') counts.fail++
      else counts.todo++
    }
  } catch {
    /* malformed or absent */
  }

  return {
    contract: readIfExists(join(dir, 'contract.md')),
    progress: readIfExists(join(dir, 'progress.md')),
    log: readIfExists(join(dir, 'log.md')),
    scores,
    turns,
    assertions: counts,
    plateau: detectPlateau(scores.map((s) => s.weighted).filter((n): n is number => n !== null)),
  }
}
