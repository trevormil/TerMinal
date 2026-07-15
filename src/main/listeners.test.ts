import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { isRepoRootWithin } from './repo-allowlist'

describe('automation-inbox repoRoot allowlist (security)', () => {
  const allowed = ['/Users/x/Projects', '/Users/x/Projects/.worktrees']

  test('a repo inside the projects dir is allowed', () => {
    expect(isRepoRootWithin('/Users/x/Projects/app', allowed)).toBe(true)
    expect(isRepoRootWithin('/Users/x/Projects/.worktrees/app/feat', allowed)).toBe(true)
  })

  test('the projects dir itself is allowed', () => {
    expect(isRepoRootWithin('/Users/x/Projects', allowed)).toBe(true)
  })

  test('a path outside the projects dir is rejected', () => {
    expect(isRepoRootWithin('/etc', allowed)).toBe(false)
    expect(isRepoRootWithin('/Users/x/Secrets/app', allowed)).toBe(false)
  })

  test('a sibling-prefix path is not mistaken for inside', () => {
    // '/Users/x/Projects-evil' must not match '/Users/x/Projects'
    expect(isRepoRootWithin('/Users/x/Projects-evil/app', allowed)).toBe(false)
  })

  test('a .. traversal that escapes is rejected', () => {
    expect(isRepoRootWithin('/Users/x/Projects/../Secrets/app', allowed)).toBe(false)
  })

  test('an empty repoRoot is rejected', () => {
    expect(isRepoRootWithin('', allowed)).toBe(false)
  })
})

// listeners.ts resolves its settings path from homedir() at load and imports
// electron-touching modules (agents/bg-tasks), so each case runs in a
// subprocess with a throwaway HOME + a mocked electron.
const run = (home: string, code: string): Record<string, unknown> => {
  const result = spawnSync(process.execPath, ['--eval', code], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

const probe = (home: string, write?: string) =>
  run(
    home,
    `import { mock } from 'bun:test';
mock.module('electron', () => ({ Notification: class { static isSupported() { return false } show() {} }, app: { getPath: () => '${home}' } }));
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
${
  write === undefined
    ? ''
    : `const dir = join('${home}', '.config', 'TerMinal', 'automation-inbox');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'settings.json'), '${write}');`
}
const L = await import('./src/main/listeners.ts');
console.log(JSON.stringify(L.readListenerSettings()));`,
  )

describe('automation inbox default is opt-in (security)', () => {
  test('absent config → disabled (never auto-runs on a fresh install)', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-listeners-'))
    try {
      expect(probe(home).enabled).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('explicit enabled:true is honored', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-listeners-'))
    try {
      expect(probe(home, '{"enabled":true}').enabled).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test('explicit enabled:false stays disabled', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-listeners-'))
    try {
      expect(probe(home, '{"enabled":false}').enabled).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
