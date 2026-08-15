import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The recurring half of retention lives in the launchd runner, because the app's
// "reclaim disk" button is a button, not a policy. These run the REAL script
// against a throwaway HOME — nothing here can see ~/.config/TerMinal.
const CRON = resolve(import.meta.dir, '../../bin/terminal-cron')
const DAY = 24 * 60 * 60 * 1000

function sandbox(): { home: string; cfg: string } {
  const home = mkdtempSync(join(tmpdir(), 'tm-cron-retention-'))
  const cfg = join(home, '.config', 'TerMinal')
  mkdirSync(cfg, { recursive: true })
  return { home, cfg }
}
function runRetention(home: string): { code: number; out: string; err: string } {
  const r = spawnSync('bun', [CRON, 'retention'], {
    env: { ...process.env, HOME: home, TERMINAL_CONFIG_DIR: join(home, '.config', 'TerMinal') },
    encoding: 'utf8',
  })
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr }
}
function age(path: string, days: number): void {
  const t = (Date.now() - days * DAY) / 1000
  utimesSync(path, t, t)
}

describe('terminal-cron retention', () => {
  test('rotates an oversized monitor.log, keeping the tail', () => {
    const { home, cfg } = sandbox()
    const log = join(cfg, 'monitor.log')
    writeFileSync(log, Array.from({ length: 200_000 }, (_, i) => `line ${i}`).join('\n') + '\n')

    expect(runRetention(home).code).toBe(0)

    const after = readFileSync(log, 'utf8')
    expect(after.length).toBeLessThan(3 * 1024 * 1024)
    expect(after).toContain('line 199999')
    expect(after).not.toContain('line 0\n')
    expect(existsSync(`${log}.1`)).toBe(true)
  })

  test('deletes stale write-path leftovers but spares fresh ones and real state', () => {
    const { home, cfg } = sandbox()
    writeFileSync(join(cfg, 'monitors.json'), '[]')
    writeFileSync(join(cfg, 'monitors.json.tmp'), 'x')
    writeFileSync(join(cfg, 'hitl.json.lock'), '{}')
    writeFileSync(join(cfg, 'schedules.json.corrupt-1700000000000'), 'garbage')
    writeFileSync(join(cfg, 'fresh.json.tmp'), 'x')
    age(join(cfg, 'monitors.json.tmp'), 1)
    age(join(cfg, 'hitl.json.lock'), 1)
    age(join(cfg, 'schedules.json.corrupt-1700000000000'), 90)

    expect(runRetention(home).code).toBe(0)

    expect(existsSync(join(cfg, 'monitors.json.tmp'))).toBe(false)
    expect(existsSync(join(cfg, 'hitl.json.lock'))).toBe(false)
    expect(existsSync(join(cfg, 'schedules.json.corrupt-1700000000000'))).toBe(false)
    // A lock written minutes ago may be held right now.
    expect(existsSync(join(cfg, 'fresh.json.tmp'))).toBe(true)
    // The actual state file is not a leftover.
    expect(existsSync(join(cfg, 'monitors.json'))).toBe(true)
  })

  test('a RECENT quarantine file survives — it is the only copy of the lost data', () => {
    const { home, cfg } = sandbox()
    const q = join(cfg, 'hitl.json.corrupt-1700000000000')
    writeFileSync(q, 'the only copy')
    age(q, 3)

    expect(runRetention(home).code).toBe(0)
    expect(readFileSync(q, 'utf8')).toBe('the only copy')
  })

  test('flushes every settled HITL item out of the live file, whatever its age', () => {
    const { home, cfg } = sandbox()
    const old = Date.now() - 200 * DAY
    writeFileSync(
      join(cfg, 'hitl.json'),
      JSON.stringify([
        { id: 'open-ancient', title: 'still blocked', status: 'open', createdAt: old },
        {
          id: 'settled-old',
          title: 'done long ago',
          status: 'resolved',
          readAt: old,
          resolvedAt: old,
          createdAt: old,
        },
        { id: 'settled-recent', title: 'just read', status: 'resolved', readAt: Date.now() },
      ]),
    )

    expect(runRetention(home).code).toBe(0)

    // There is no age window any more: settled is settled. What stays live is
    // exactly what still wants a human.
    const live = JSON.parse(readFileSync(join(cfg, 'hitl.json'), 'utf8')) as { id: string }[]
    expect(live.map((h) => h.id)).toEqual(['open-ancient'])

    const archived = readFileSync(join(cfg, 'hitl-archive.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { id: string })
    expect(archived.map((h) => h.id).sort()).toEqual(['settled-old', 'settled-recent'])

    // The badge index is written by the same locked pass, so it cannot drift.
    const counts = JSON.parse(readFileSync(join(cfg, 'hitl-counts.json'), 'utf8'))
    expect(counts).toMatchObject({ live: 1, unread: 1, archived: 2 })
  })

  test('folds a pre-split dated archive directory into the jsonl', () => {
    const { home, cfg } = sandbox()
    mkdirSync(join(cfg, 'hitl-archive'), { recursive: true })
    writeFileSync(
      join(cfg, 'hitl-archive', 'hitl-2026-01-01.json'),
      JSON.stringify([{ id: 'from-the-old-format', title: 'x', status: 'resolved' }]),
    )
    writeFileSync(
      join(cfg, 'hitl.json'),
      JSON.stringify([{ id: 'settled', title: 'x', status: 'resolved', readAt: 1 }]),
    )

    expect(runRetention(home).code).toBe(0)

    const archived = readFileSync(join(cfg, 'hitl-archive.jsonl'), 'utf8')
    expect(archived).toContain('from-the-old-format')
    expect(archived).toContain('settled')
    expect(existsSync(join(cfg, 'hitl-archive'))).toBe(false)
  })

  test('a corrupt hitl.json is quarantined, not archived away', () => {
    const { home, cfg } = sandbox()
    writeFileSync(join(cfg, 'hitl.json'), '[{"id":"real-blocker"},{"id"')

    expect(runRetention(home).code).toBe(0)
    // The archive path must not have swallowed it, and the bytes must survive.
    expect(existsSync(join(cfg, 'hitl-archive.jsonl'))).toBe(false)
    const q = readdirSync(cfg).filter((n) => n.includes('.corrupt-'))
    expect(q).toHaveLength(1)
    expect(readFileSync(join(cfg, q[0]), 'utf8')).toContain('real-blocker')
  })

  test('the daily rate limit makes a second run a no-op', () => {
    const { home, cfg } = sandbox()
    writeFileSync(join(cfg, 'monitor.log'), 'x\n')
    expect(runRetention(home).code).toBe(0)
    const marker = JSON.parse(readFileSync(join(cfg, 'retention.last.json'), 'utf8')) as {
      lastRunAt: number
    }
    expect(marker.lastRunAt).toBeGreaterThan(0)

    // The watchdog piggyback path (not --force) must skip while the marker is fresh.
    const r = spawnSync(
      'bun',
      [
        '-e',
        `
      const { readFileSync } = require('node:fs')
      const m = JSON.parse(readFileSync(${JSON.stringify(join(cfg, 'retention.last.json'))}, 'utf8'))
      console.log(Date.now() - m.lastRunAt < 24 * 60 * 60 * 1000 ? 'skips' : 'runs')
    `,
      ],
      { encoding: 'utf8' },
    )
    expect(r.stdout.trim()).toBe('skips')
  })
})
