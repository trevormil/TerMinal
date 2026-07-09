import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// buildCmd resolves binaries via enginePath (reads ~/.config/TerMinal settings)
// and agents.ts imports electron transitively, so run in a subprocess with a
// throwaway HOME + a mocked electron. Returns buildCmd output for each case.
const build = (): Record<string, string> => {
  const home = mkdtempSync(join(tmpdir(), 'terminal-buildcmd-'))
  try {
    const r = spawnSync(
      process.execPath,
      [
        '--eval',
        `import { mock } from 'bun:test';
mock.module('electron', () => ({ Notification: class { static isSupported() { return false } show() {} }, app: { getPath: () => '${home}', isPackaged: false } }));
const { buildCmd } = await import('./src/main/agents.ts');
console.log(JSON.stringify({
  hermes: buildCmd('hermes', '/wt', 'do it', 'x/y'),
  orHermes: buildCmd('openrouter', '/wt', 'do it', 'deepseek/v3.2', 'hermes'),
  orCodex: buildCmd('openrouter', '/wt', 'do it', 'deepseek/v3.2', 'codex'),
  claude: buildCmd('claude', '/wt', 'do it', 'opus'),
}));`,
      ],
      { cwd: process.cwd(), env: { ...process.env, HOME: home }, encoding: 'utf8' },
    )
    if (r.status !== 0) throw new Error(r.stderr || r.stdout)
    return JSON.parse(r.stdout)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe('buildCmd — hermes + openrouter harness', () => {
  const cmds = build()

  test('hermes engine → one-shot with usage-file, no provider override', () => {
    expect(cmds.hermes).toContain(' -z ')
    expect(cmds.hermes).toContain(" -m 'x/y'")
    expect(cmds.hermes).toContain('.terminal-hermes-usage.json')
    expect(cmds.hermes).toContain('--yolo')
    expect(cmds.hermes).toContain('--accept-hooks')
    expect(cmds.hermes).not.toContain('--provider')
  })

  test('openrouter + hermes harness → hermes with --provider openrouter', () => {
    expect(cmds.orHermes).toContain("'hermes' -z ")
    expect(cmds.orHermes).toContain("--provider 'openrouter'")
    expect(cmds.orHermes).toContain(" -m 'deepseek/v3.2'")
    expect(cmds.orHermes).toContain('.terminal-hermes-usage.json')
  })

  test('openrouter + codex harness → or-agent form (--dir), no hermes provider flag', () => {
    expect(cmds.orCodex).toContain('--dir')
    expect(cmds.orCodex).toContain("--model 'deepseek/v3.2'")
    expect(cmds.orCodex).not.toContain('--provider openrouter')
  })

  test('claude unchanged', () => {
    expect(cmds.claude).toContain(' -p ')
    expect(cmds.claude).toContain('--permission-mode auto')
  })
})
