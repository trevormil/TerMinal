import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

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
