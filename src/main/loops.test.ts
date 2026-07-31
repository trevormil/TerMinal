import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { decideOutcome } from './loop-decide'

// loops.ts is coupled to ~/.config/TerMinal and creates real git worktrees, so
// each case runs in a subprocess with a throwaway HOME (isolating loops.json +
// worktrees) and a mocked electron (events.ts imports Notification at load).
const run = (home: string, code: string): Record<string, unknown> => {
  const result = spawnSync(process.execPath, ['--eval', code], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

const setup = (home: string, body: string): string =>
  `import { mock } from 'bun:test';
mock.module('electron', () => ({ Notification: class { static isSupported() { return false } show() {} } }));
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const repo = join('${home}', 'repo');
mkdirSync(repo, { recursive: true });
execSync('git init -q && git config user.email t@t.co && git config user.name t && git commit -q --allow-empty -m init', { cwd: repo, stdio: 'pipe' });
const loops = await import('./src/main/loops.ts');
${body}`

describe('loop modes', () => {
  test('paired loop is created in paired mode and refuses auto-stepping', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-loops-paired-'))
    try {
      const r = run(
        home,
        setup(
          home,
          `const paired = loops.createLoop({ repoRoot: repo, goal: 'paired test goal', mode: 'paired' });
if ('error' in paired) throw new Error(paired.error);
const step = loops.stepLoop(paired.id);
console.log(JSON.stringify({ mode: paired.mode, phase: paired.phase, hasWorktree: !!paired.worktree, stepError: step.error }));`,
        ),
      )
      expect(r.mode).toBe('paired')
      expect(r.phase).toBe('negotiate')
      expect(r.hasWorktree).toBe(true)
      expect(r.stepError).toBe('paired loops are driven by their live sessions')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('single loop starts in generate at iteration 1 and refuses auto-stepping', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-loops-single-'))
    try {
      const r = run(
        home,
        setup(
          home,
          `const s = loops.createLoop({ repoRoot: repo, goal: 'single test goal', mode: 'single' });
if ('error' in s) throw new Error(s.error);
const step = loops.stepLoop(s.id);
console.log(JSON.stringify({ mode: s.mode, phase: s.phase, nextRole: s.nextRole, iteration: s.iteration, hasWorktree: !!s.worktree, stepError: step.error }));`,
        ),
      )
      expect(r.mode).toBe('single')
      expect(r.phase).toBe('generate')
      expect(r.nextRole).toBe('generator')
      expect(r.iteration).toBe(1)
      expect(r.hasWorktree).toBe(true)
      expect(r.stepError).toBe('single loops are driven by their live session + auto-grader')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('createLoop defaults to headless mode (unchanged behavior)', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-loops-headless-'))
    try {
      const r = run(
        home,
        setup(
          home,
          `const rec = loops.createLoop({ repoRoot: repo, goal: 'headless test goal' });
if ('error' in rec) throw new Error(rec.error);
console.log(JSON.stringify({ mode: rec.mode, phase: rec.phase, nextRole: rec.nextRole }));`,
        ),
      )
      expect(r.mode).toBe('headless')
      expect(r.phase).toBe('negotiate')
      expect(r.nextRole).toBe('planner')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

// The single most safety-critical property: a loop cannot run forever. decide()
// delegates the whole stop rule to decideOutcome, and a generate turn (spawned
// in headless, delivered to the live session in single mode) only happens after
// decideOutcome returns 'continue'. So proving this pure function is bounded
// proves the loop is bounded.
describe('decideOutcome — termination guarantee', () => {
  test('the iteration cap forces done regardless of model progress', () => {
    // Worst case: contract NEVER converges (allPass=false forever).
    expect(decideOutcome(5, 5, false, false)).toBe('done')
    expect(decideOutcome(6, 5, false, false)).toBe('done')
    expect(decideOutcome(25, 25, false, false)).toBe('done')
    // Below the cap it keeps going.
    expect(decideOutcome(4, 5, false, false)).toBe('continue')
    expect(decideOutcome(1, 25, false, false)).toBe('continue')
  })

  test('convergence (all assertions pass + taste plateau) stops early', () => {
    expect(decideOutcome(3, 25, true, true)).toBe('done')
    // Not converged unless BOTH hold — a passing build with a still-moving
    // taste score keeps iterating.
    expect(decideOutcome(3, 25, true, false)).toBe('continue')
    expect(decideOutcome(3, 25, false, true)).toBe('continue')
  })

  test('a never-converging worst case halts in exactly maxIterations turns', () => {
    // Simulate the driver loop: start at iteration 1, only advance while
    // decideOutcome says continue. The count of generate turns must be bounded
    // by the cap even though the models never satisfy the contract.
    for (const cap of [1, 2, 5, 25, 100]) {
      let iteration = 1
      let turns = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        turns++
        if (decideOutcome(iteration, cap, false, false) === 'done') break
        iteration++
        expect(turns).toBeLessThanOrEqual(cap) // never spins past the cap
      }
      expect(turns).toBe(cap)
    }
  })
})

// ---------------------------------------------------------------------------
// Loop history (read-only surface behind the Loops tab)
// ---------------------------------------------------------------------------

describe('parseScoreValue', () => {
  test('pulls the weighted score out of an evaluator score file', async () => {
    const { parseScoreValue } = await import('./loop-history')
    expect(parseScoreValue('# score\nweighted: 0.82\nnotes: ok')).toBe(0.82)
  })

  test('handles an integer score and a score of zero', async () => {
    const { parseScoreValue } = await import('./loop-history')
    expect(parseScoreValue('weighted: 1')).toBe(1)
    expect(parseScoreValue('weighted: 0')).toBe(0)
  })

  test('does not mistake an "unweighted:" line for the weighted total', async () => {
    // Evaluators report both a raw and a weighted number; a substring match on
    // "weighted:" silently reads the wrong one, poisoning the trend and the
    // plateau verdict with no error.
    const { parseScoreValue } = await import('./loop-history')
    expect(parseScoreValue('unweighted: 0.30\nweighted: 0.82\n')).toBe(0.82)
    expect(parseScoreValue('unweighted: 0.30\n')).toBeNull()
  })

  test('returns null when there is no weighted line, rather than 0', async () => {
    // 0 and "unscored" must stay distinguishable — a missing score is not a bad score.
    const { parseScoreValue } = await import('./loop-history')
    expect(parseScoreValue('no score here')).toBeNull()
    expect(parseScoreValue('')).toBeNull()
  })
})

describe('detectPlateau', () => {
  test('a steadily improving run has not plateaued', async () => {
    const { detectPlateau } = await import('./loop-history')
    const p = detectPlateau([0.2, 0.4, 0.6, 0.8], 3)
    expect(p.plateaued).toBe(false)
    expect(p.sinceImprovement).toBe(0)
    expect(p.best).toBe(0.8)
  })

  test('flat scores across the window plateau', async () => {
    const { detectPlateau } = await import('./loop-history')
    const p = detectPlateau([0.5, 0.81, 0.81, 0.815, 0.82], 3)
    expect(p.plateaued).toBe(true)
    expect(p.best).toBe(0.82)
  })

  test('a late improvement resets the counter', async () => {
    const { detectPlateau } = await import('./loop-history')
    const p = detectPlateau([0.5, 0.5, 0.5, 0.9], 3)
    expect(p.plateaued).toBe(false)
    expect(p.sinceImprovement).toBe(0)
  })

  test('counts turns since the best score, not since the last change', async () => {
    // Regressing is not improving — a dip after the peak still counts as stalled.
    const { detectPlateau } = await import('./loop-history')
    const p = detectPlateau([0.9, 0.4, 0.5, 0.6], 3)
    expect(p.sinceImprovement).toBe(3)
    expect(p.plateaued).toBe(true)
    expect(p.best).toBe(0.9)
  })

  test('too few samples cannot conclude a plateau', async () => {
    const { detectPlateau } = await import('./loop-history')
    expect(detectPlateau([], 3).plateaued).toBe(false)
    expect(detectPlateau([0.5], 3).plateaued).toBe(false)
    expect(detectPlateau([0.5, 0.5], 3).plateaued).toBe(false)
    expect(detectPlateau([], 3).best).toBeNull()
  })

  test('improvement must clear epsilon to count', async () => {
    const { detectPlateau } = await import('./loop-history')
    // +0.001 per turn is noise, not progress.
    expect(detectPlateau([0.8, 0.801, 0.802, 0.803], 3).plateaued).toBe(true)
    expect(detectPlateau([0.8, 0.9, 1.0, 1.1], 3).plateaued).toBe(false)
  })
})

describe('readLoopHistoryAt', () => {
  const seed = (): string => {
    const { mkdirSync, writeFileSync } = require('node:fs')
    const dir = mkdtempSync(join(tmpdir(), 'loop-hist-'))
    mkdirSync(join(dir, 'scores'), { recursive: true })
    mkdirSync(join(dir, 'turns'), { recursive: true })
    writeFileSync(join(dir, 'contract.md'), '# Contract\nGoal: ship it\n')
    writeFileSync(
      join(dir, 'feature_list.json'),
      JSON.stringify({ assertions: [{ status: 'pass' }, { status: 'fail' }, { status: 'todo' }] }),
    )
    writeFileSync(join(dir, 'log.md'), '## [2026-07-31] init\n')
    writeFileSync(join(dir, 'scores', '0001.md'), 'weighted: 0.4\n')
    writeFileSync(join(dir, 'scores', '0002.md'), 'weighted: 0.7\n')
    writeFileSync(join(dir, 'turns', '1-generator-abc.log'), 'hello')
    writeFileSync(join(dir, 'turns', '2-evaluator-def.log'), 'world')
    return dir
  }

  test('reads the contract, scores, turns and assertion counts off disk', async () => {
    const { readLoopHistoryAt } = await import('./loop-history')
    const dir = seed()
    try {
      const h = readLoopHistoryAt(dir)
      expect(h.contract).toContain('Goal: ship it')
      expect(h.scores.map((s) => s.weighted)).toEqual([0.4, 0.7])
      expect(h.assertions).toEqual({ total: 3, pass: 1, fail: 1, todo: 1 })
      expect(h.turns).toHaveLength(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('parses iteration and role out of turn filenames', async () => {
    const { readLoopHistoryAt } = await import('./loop-history')
    const dir = seed()
    try {
      const t = readLoopHistoryAt(dir).turns
      expect(t[0]).toMatchObject({ iteration: 1, role: 'generator' })
      expect(t[1]).toMatchObject({ iteration: 2, role: 'evaluator' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('reads the turn number out of a zero-padded score filename', async () => {
    // The evaluator writes scores/NNNN.md (loop-driver SKILL.md step 4), so the
    // trend's x-axis depends on "0010" parsing as 10, not on the string order.
    const { writeFileSync } = require('node:fs')
    const { readLoopHistoryAt } = await import('./loop-history')
    const dir = seed()
    try {
      writeFileSync(join(dir, 'scores', '0010.md'), 'weighted: 0.9\n')
      const s = readLoopHistoryAt(dir).scores
      expect(s.map((x) => x.iteration)).toEqual([1, 2, 10])
      expect(s.map((x) => x.weighted)).toEqual([0.4, 0.7, 0.9])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('an empty or missing loop directory yields empty history, not a throw', async () => {
    const { readLoopHistoryAt } = await import('./loop-history')
    const dir = mkdtempSync(join(tmpdir(), 'loop-empty-'))
    try {
      const h = readLoopHistoryAt(dir)
      expect(h.scores).toEqual([])
      expect(h.turns).toEqual([])
      expect(h.contract).toBe('')
      expect(h.plateau.plateaued).toBe(false)
      expect(readLoopHistoryAt(join(dir, 'nope')).scores).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('reports a plateau computed from the score series', async () => {
    const { writeFileSync } = require('node:fs')
    const { readLoopHistoryAt } = await import('./loop-history')
    const dir = seed()
    try {
      // Real gain at turn 2 (0.4 -> 0.7), then three turns of sub-epsilon noise.
      writeFileSync(join(dir, 'scores', '0003.md'), 'weighted: 0.705\n')
      writeFileSync(join(dir, 'scores', '0004.md'), 'weighted: 0.71\n')
      writeFileSync(join(dir, 'scores', '0005.md'), 'weighted: 0.712\n')
      const h = readLoopHistoryAt(dir)
      expect(h.plateau.sinceImprovement).toBe(3)
      expect(h.plateau.plateaued).toBe(true)
      expect(h.plateau.best).toBe(0.712)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
