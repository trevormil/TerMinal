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
