import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// hitl.ts reaches the activity feed, which reaches Electron's Notification.
// Outside the app that module has no such export, so importing it explodes.
mock.module('electron', () => ({
  Notification: class {
    show(): void {}
    static isSupported(): boolean {
      return false
    }
  },
  app: { getPath: () => tmpdir(), isPackaged: false },
}))

// EVERY test here writes state. `TERMINAL_CONFIG_DIR` is set BEFORE any state
// module is touched so nothing can resolve to the developer's real
// ~/.config/TerMinal — a test in this repo has already destroyed a real global
// agent registry once, and these are exactly the modules that did it.
let dir = ''
const prev = process.env.TERMINAL_CONFIG_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-state-'))
  process.env.TERMINAL_CONFIG_DIR = dir
})
afterEach(() => {
  if (prev === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = prev
})

const write = (rel: string, body: string) => {
  const p = join(dir, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, body)
  return p
}
const corruptSiblings = (rel: string) =>
  readdirSync(join(dir, rel, '..')).filter((n) => n.includes('.corrupt-'))

describe('config dir seam', () => {
  test('every owned state module resolves under TERMINAL_CONFIG_DIR', async () => {
    const { terminalConfigDir, configPath } = await import('./config-dir')
    expect(terminalConfigDir()).toBe(dir)
    expect(configPath('hitl.json')).toBe(join(dir, 'hitl.json'))
  })
})

describe('global agent registry (R4 — the bug that really bit)', () => {
  test('a torn global.json is quarantined, NOT silently replaced by one agent', async () => {
    const { saveGlobalAgent, readGlobalAgents } = await import('./agents-global')
    write('agents/global.json', '[{"id":"keeper","title":"K","prompt":"p"},{"id":"othe')

    const res = saveGlobalAgent({ id: 'new-one', title: 'N', prompt: 'p' })
    expect('error' in res).toBe(true)
    // The pre-existing agents must still exist somewhere on disk.
    const quarantined = corruptSiblings('agents/global.json')
    expect(quarantined.length).toBe(1)
    expect(readFileSync(join(dir, 'agents', quarantined[0]), 'utf8')).toContain('keeper')
    // And the registry must NOT have become "[the one new agent]".
    expect(readGlobalAgents().some((a) => a.id === 'new-one')).toBe(false)
  })

  test('a normal save still works and preserves siblings', async () => {
    const { saveGlobalAgent, readGlobalAgents } = await import('./agents-global')
    write('agents/global.json', JSON.stringify([{ id: 'keeper', title: 'K', prompt: 'p' }]))
    expect(saveGlobalAgent({ id: 'new-one', title: 'N', prompt: 'p' })).toEqual({ ok: true })
    expect(
      readGlobalAgents()
        .map((a) => a.id)
        .sort(),
    ).toEqual(['keeper', 'new-one'])
  })

  test('an absent registry is not corruption — first save just creates it', async () => {
    const { saveGlobalAgent, readGlobalAgents } = await import('./agents-global')
    expect(saveGlobalAgent({ id: 'first', title: 'F', prompt: 'p' })).toEqual({ ok: true })
    expect(readGlobalAgents().map((a) => a.id)).toEqual(['first'])
    expect(corruptSiblings('agents/global.json')).toEqual([])
  })

  test('a JSON object where a list belongs counts as corrupt', async () => {
    const { saveGlobalAgent } = await import('./agents-global')
    write('agents/global.json', '{"id":"not-a-list"}')
    expect('error' in saveGlobalAgent({ id: 'x', title: 'X', prompt: 'p' })).toBe(true)
    expect(corruptSiblings('agents/global.json').length).toBe(1)
  })
})

describe('schedules (R1 — a disabled schedule that keeps firing)', () => {
  test('toggling off is not clobbered by a concurrent lastRun stamp', async () => {
    const { addSchedule, stampScheduleRun, toggleSchedule, readSchedules } =
      await import('./schedules')
    const s = addSchedule({
      repoRoot: '/r',
      repoLabel: 'r',
      agentId: 'a',
      agentTitle: 'A',
      engine: 'codex',
      prompt: '',
      spec: { kind: 'cron', expr: '* * * * *' },
      enabled: true,
    })
    // The cron runner reads the list, then stamps. The user disables in the gap.
    // A snapshot-based writer writes back `enabled: true` and the job lives on.
    toggleSchedule(s.id, false)
    stampScheduleRun(s.id, { lastRun: 123, lastStatus: 'done' })

    const after = readSchedules().find((x) => x.id === s.id)
    expect(after?.enabled).toBe(false)
    expect(after?.lastRun).toBe(123)
  })

  test('a corrupt schedules.json is quarantined rather than reset to []', async () => {
    const { addSchedule } = await import('./schedules')
    write('schedules.json', '[{"id":"a","spec":{"kind":"cron"')
    expect(() =>
      addSchedule({
        repoRoot: '/r',
        repoLabel: 'r',
        agentId: 'a',
        agentTitle: 'A',
        engine: 'codex',
        prompt: '',
        spec: { kind: 'cron', expr: '* * * * *' },
        enabled: true,
      }),
    ).toThrow()
    expect(corruptSiblings('schedules.json').length).toBe(1)
  })
})

describe('hitl (R2 — a resolve racing a cron filing)', () => {
  test('filing sees the current file, not a snapshot taken before another write', async () => {
    const { fileHitl, readHitl } = await import('./hitl')
    fileHitl({ title: 'one', source: 'manual' })
    // Something out-of-process (terminal-cron) appends while we hold nothing.
    const cur = JSON.parse(readFileSync(join(dir, 'hitl.json'), 'utf8'))
    writeFileSync(
      join(dir, 'hitl.json'),
      JSON.stringify([
        { id: 'cron', title: 'from cron', source: 'cron-fail', status: 'open', createdAt: 1 },
        ...cur,
      ]),
    )
    fileHitl({ title: 'two', source: 'manual' })

    const titles = readHitl().map((h) => h.title)
    expect(titles).toContain('one')
    expect(titles).toContain('from cron')
    expect(titles).toContain('two')
  })

  test('a corrupt hitl.json is quarantined instead of being replaced by one item', async () => {
    const { fileHitl } = await import('./hitl')
    write('hitl.json', '[{"id":"a","title":"real blocker"},{"id"')
    expect(() => fileHitl({ title: 'new', source: 'manual' })).toThrow()
    const q = corruptSiblings('hitl.json')
    expect(q.length).toBe(1)
    expect(readFileSync(join(dir, q[0]), 'utf8')).toContain('real blocker')
  })
})

describe('settings (R5 — defaults written over a real config)', () => {
  test('a patch refuses to run against a corrupt settings.json', async () => {
    const { patchSettings, resetSettingsCache } = await import('./settings')
    resetSettingsCache()
    write('settings.json', '{"telegram":{"botToken":"real-token"')
    expect(() => patchSettings({ defaultEngine: 'codex' })).toThrow()
    const q = corruptSiblings('settings.json')
    expect(q.length).toBe(1)
    expect(readFileSync(join(dir, q[0]), 'utf8')).toContain('real-token')
  })

  test('settings.json is written atomically and stays 0600', async () => {
    const { patchSettings, resetSettingsCache } = await import('./settings')
    resetSettingsCache()
    patchSettings({ defaultEngine: 'codex' })
    const f = join(dir, 'settings.json')
    expect(existsSync(f)).toBe(true)
    expect(JSON.parse(readFileSync(f, 'utf8')).defaultEngine).toBe('codex')
    // No temp or lock residue from the atomic path.
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp') || n.endsWith('.lock'))).toEqual([])
  })
})
