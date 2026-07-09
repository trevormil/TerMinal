import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

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
