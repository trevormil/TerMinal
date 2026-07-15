import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

describe('terminal-cli deploy', () => {
  test('emits deploy activity with repo and run context', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-cli-home-'))
    const repo = mkdtempSync(join(tmpdir(), 'terminal-cli-repo-'))
    const result = spawnSync(
      'bun',
      ['bin/terminal-cli', 'deploy', 'production', 'abc123', 'v1.2.3'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: home,
          TERMINAL_REPO: repo,
          TERMINAL_RUN_ID: 'run-1',
          TERMINAL_AGENT_ID: 'deploy-agent',
        },
        encoding: 'utf8',
      },
    )

    expect(result.status).toBe(0)
    const line = readFileSync(join(home, '.config', 'TerMinal', 'activity.jsonl'), 'utf8').trim()
    const event = JSON.parse(line)
    expect(event).toMatchObject({
      kind: 'deploy',
      title: 'Deploy · production',
      detail: 'abc123 · v1.2.3',
      repoRoot: repo,
      runId: 'run-1',
      runSource: 'cron',
    })
  })

  test('requires an environment name', () => {
    const home = mkdtempSync(join(tmpdir(), 'terminal-cli-home-'))
    mkdirSync(join(home, '.config', 'TerMinal'), { recursive: true })
    const result = spawnSync('bun', ['bin/terminal-cli', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('environment/name is required')
  })
})
