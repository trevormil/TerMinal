import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CRON = resolve(import.meta.dir, '../../bin/terminal-cron')

// Regression for the budget-gate TDZ crash: the refusal path built the HITL
// with `repoRoot: repo` while `const repo` was declared ~35 lines below, so a
// budget-capped fire threw ReferenceError before fileHitl ran — the runner
// crashed non-zero AND the operator got no "run refused" notification.
test('budget-refused cron run exits 0 and files a HITL (no TDZ crash)', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-cron-')))
  try {
    const cfg = join(home, '.config', 'TerMinal')
    mkdirSync(join(cfg, 'ai-runs'), { recursive: true })
    const id = 'sched-test'
    writeFileSync(
      join(cfg, 'schedules.json'),
      JSON.stringify([
        { id, agentId: 'demo', agentTitle: 'Demo', engine: 'codex', prompt: 'x', repoRoot: '/tmp/demo-repo', repoLabel: 'demo-repo', enabled: true },
      ]),
    )
    writeFileSync(join(cfg, 'budgets.json'), JSON.stringify({ dailyTotalUsd: 0.01 }))
    writeFileSync(join(cfg, 'ai-runs', 'r.json'), JSON.stringify({ startedAt: Date.now(), costUsd: 5, agentId: 'demo' }))

    let exitCode = 0
    try {
      execFileSync('bun', [CRON, 'run', id], { env: { ...process.env, HOME: home }, encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      exitCode = (e as { status?: number }).status ?? 1
    }

    expect(exitCode).toBe(0)
    const hitl = JSON.parse(readFileSync(join(cfg, 'hitl.json'), 'utf8'))
    expect(Array.isArray(hitl)).toBe(true)
    expect(hitl[0].title).toContain('Cron run refused')
    expect(hitl[0].repoRoot).toBe('/tmp/demo-repo')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
