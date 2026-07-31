import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Packs write into schedules.json and presets.json — both REAL user state that
// drives launchd. Every test redirects both through their env seams into a
// mkdtemp dir; nothing here may touch ~/.config/TerMinal.
const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tm-packs-'))
  roots.push(root)
  process.env.TERMINAL_SCHEDULES_FILE = join(root, 'schedules.json')
  process.env.TERMINAL_PRESETS_FILE = join(root, 'presets.json')
  return root
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
  delete process.env.TERMINAL_SCHEDULES_FILE
  delete process.env.TERMINAL_PRESETS_FILE
})

const REPO = '/Users/x/code/TerMinal'

function schedules(root: string): Record<string, unknown>[] {
  try {
    return JSON.parse(readFileSync(join(root, 'schedules.json'), 'utf8'))
  } catch {
    return []
  }
}

describe('the pack catalog', () => {
  test('every pack has a stable id, at least one agent, and a cadence', async () => {
    const { PACKS } = await import('./packs')
    expect(PACKS.length).toBeGreaterThan(0)
    expect(new Set(PACKS.map((p) => p.id)).size).toBe(PACKS.length)
    for (const p of PACKS) {
      expect(p.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.agents.length).toBeGreaterThan(0)
      for (const a of p.agents) {
        expect(a.agentId).toMatch(/^[a-z0-9][a-z0-9-]*$/)
        expect(a.prompt.length).toBeGreaterThan(20)
        expect(a.spec).toBeTruthy()
      }
    }
  })

  test('agent ids are unique across the whole catalog', async () => {
    const { PACKS } = await import('./packs')
    // seedSchedule is idempotent on (repoRoot, agentId), so two packs sharing an
    // agent id would silently collide: enabling the second would adopt the
    // first's schedule instead of creating its own.
    const ids = PACKS.flatMap((p) => p.agents.map((a) => a.agentId))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the research/teacher agent is pinned to claude, never codex', async () => {
    const { PACKS } = await import('./packs')
    const teacher = PACKS.flatMap((p) => p.agents).find((a) => a.agentId === 'research-teacher')
    expect(teacher).toBeTruthy()
    // Runs default to `codex exec`, which has no web search — a codex run of a
    // research agent silently produces a lesson from training data.
    expect(teacher!.engine).toBe('claude')
  })

  test('the daily agents are staggered, not all firing at the same minute', async () => {
    const { PACKS } = await import('./packs')
    const times = PACKS.flatMap((p) => p.agents)
      .map((a) => a.spec)
      .filter((s): s is { kind: 'calendar'; hour: number; minute: number } => s.kind === 'calendar')
      .map((s) => `${s.hour}:${s.minute}`)
    expect(times.length).toBeGreaterThan(2)
    expect(new Set(times).size).toBe(times.length)
  })

  test('the briefing fires after the agents it summarizes', async () => {
    const { PACKS } = await import('./packs')
    const all = PACKS.flatMap((p) => p.agents)
    const at = (id: string) => {
      const s = all.find((a) => a.agentId === id)!.spec as { hour: number; minute: number }
      return s.hour * 60 + s.minute
    }
    // A briefing that runs before the producers summarizes yesterday.
    for (const producer of ['coverage', 'deps-quality', 'ticket-ideas']) {
      expect(at('briefing')).toBeGreaterThan(at(producer))
    }
  })
})

describe('enablePack', () => {
  test('seeds one enabled schedule per agent in the pack', async () => {
    const root = tempRoot()
    const { enablePack, PACKS } = await import(`./packs.ts?t=${Date.now()}-a`)
    const pack = PACKS.find((p: { id: string }) => p.id === 'daily-quality')!

    const r = enablePack(REPO, 'TerMinal', 'daily-quality')
    expect(r.ok).toBe(true)

    const list = schedules(root)
    expect(list).toHaveLength(pack.agents.length)
    expect(list.every((s) => s.enabled === true)).toBe(true)
    expect(list.every((s) => s.repoRoot === REPO && s.repoLabel === 'TerMinal')).toBe(true)
  })

  test('enabling twice does not duplicate schedules', async () => {
    const root = tempRoot()
    const { enablePack } = await import(`./packs.ts?t=${Date.now()}-b`)
    enablePack(REPO, 'TerMinal', 'daily-quality')
    const first = schedules(root).length
    enablePack(REPO, 'TerMinal', 'daily-quality')
    expect(schedules(root)).toHaveLength(first)
  })

  test('re-enabling preserves the id and any hand-edited cadence', async () => {
    const root = tempRoot()
    const mod = await import(`./packs.ts?t=${Date.now()}-c`)
    const { updateSchedule } = await import(`./schedules.ts?t=${Date.now()}-c`)
    mod.enablePack(REPO, 'TerMinal', 'daily-quality')

    const before = schedules(root)[0]
    // The user retimes it by hand; a re-enable must not stomp that.
    updateSchedule(before.id as string, { spec: { kind: 'calendar', hour: 3, minute: 15 } })
    mod.disablePack(REPO, 'daily-quality')
    mod.enablePack(REPO, 'TerMinal', 'daily-quality')

    const after = schedules(root).find((s) => s.id === before.id)!
    expect(after).toBeTruthy()
    expect(after.spec).toEqual({ kind: 'calendar', hour: 3, minute: 15 })
    expect(after.enabled).toBe(true)
  })

  test('an unknown pack id is an error, not a silent no-op', async () => {
    tempRoot()
    const { enablePack } = await import(`./packs.ts?t=${Date.now()}-d`)
    expect(enablePack(REPO, 'TerMinal', 'nope').ok).toBe(false)
  })

  test('packs from different repos do not collide', async () => {
    const root = tempRoot()
    const { enablePack } = await import(`./packs.ts?t=${Date.now()}-e`)
    enablePack(REPO, 'TerMinal', 'daily-quality')
    enablePack('/Users/x/code/beacon', 'beacon', 'daily-quality')
    const list = schedules(root)
    expect(list.filter((s) => s.repoLabel === 'TerMinal').length).toBeGreaterThan(0)
    expect(list.filter((s) => s.repoLabel === 'beacon').length).toBeGreaterThan(0)
    expect(new Set(list.map((s) => s.id)).size).toBe(list.length)
  })
})

describe('disablePack', () => {
  test('disables without deleting, so run history and edits survive', async () => {
    const root = tempRoot()
    const { enablePack, disablePack } = await import(`./packs.ts?t=${Date.now()}-f`)
    enablePack(REPO, 'TerMinal', 'daily-quality')
    const count = schedules(root).length

    expect(disablePack(REPO, 'daily-quality').ok).toBe(true)
    const list = schedules(root)
    expect(list).toHaveLength(count)
    expect(list.every((s) => s.enabled === false)).toBe(true)
  })

  test('only touches the named pack in the named repo', async () => {
    const root = tempRoot()
    const { enablePack, disablePack } = await import(`./packs.ts?t=${Date.now()}-g`)
    enablePack(REPO, 'TerMinal', 'daily-quality')
    enablePack(REPO, 'TerMinal', 'daily-ideas')
    enablePack('/Users/x/code/beacon', 'beacon', 'daily-quality')

    disablePack(REPO, 'daily-quality')
    const list = schedules(root)
    const on = list.filter((s) => s.enabled)
    // daily-ideas in TerMinal + daily-quality in beacon stay enabled.
    expect(on.length).toBeGreaterThan(0)
    expect(on.every((s) => s.repoLabel === 'beacon' || s.agentId === 'ticket-ideas')).toBe(true)
  })
})

describe('packStatus', () => {
  test('reports off, then on, then off again', async () => {
    tempRoot()
    const { packStatus, enablePack, disablePack } = await import(`./packs.ts?t=${Date.now()}-h`)
    expect(packStatus(REPO).find((p: { id: string }) => p.id === 'daily-quality')!.state).toBe(
      'off',
    )

    enablePack(REPO, 'TerMinal', 'daily-quality')
    expect(packStatus(REPO).find((p: { id: string }) => p.id === 'daily-quality')!.state).toBe('on')

    disablePack(REPO, 'daily-quality')
    expect(packStatus(REPO).find((p: { id: string }) => p.id === 'daily-quality')!.state).toBe(
      'off',
    )
  })

  test('a pack with only some agents enabled reads as partial', async () => {
    tempRoot()
    const mod = await import(`./packs.ts?t=${Date.now()}-i`)
    const { readSchedules, toggleSchedule } = await import(`./schedules.ts?t=${Date.now()}-i`)
    mod.enablePack(REPO, 'TerMinal', 'daily-quality')
    // Turn exactly one of the pack's agents off by hand.
    toggleSchedule(readSchedules()[0].id, false)
    expect(mod.packStatus(REPO).find((p: { id: string }) => p.id === 'daily-quality')!.state).toBe(
      'partial',
    )
  })

  test('status is per-repo — enabling in one repo leaves the other off', async () => {
    tempRoot()
    const { packStatus, enablePack } = await import(`./packs.ts?t=${Date.now()}-j`)
    enablePack(REPO, 'TerMinal', 'daily-quality')
    const other = packStatus('/Users/x/code/beacon').find(
      (p: { id: string }) => p.id === 'daily-quality',
    )!
    expect(other.state).toBe('off')
  })

  test('hidden packs are excluded, and restoring brings them back', async () => {
    tempRoot()
    const { packStatus } = await import(`./packs.ts?t=${Date.now()}-k`)
    const { hidePreset, restorePreset } = await import(`./presets.ts?t=${Date.now()}-k`)
    expect(packStatus(REPO).some((p: { id: string }) => p.id === 'daily-ideas')).toBe(true)

    hidePreset('packs', 'daily-ideas')
    expect(packStatus(REPO).some((p: { id: string }) => p.id === 'daily-ideas')).toBe(false)

    restorePreset('packs', 'daily-ideas')
    expect(packStatus(REPO).some((p: { id: string }) => p.id === 'daily-ideas')).toBe(true)
  })

  test('global packs are reported alongside repo packs and marked as global', async () => {
    tempRoot()
    const { packStatus } = await import(`./packs.ts?t=${Date.now()}-l`)
    const global = packStatus(REPO).filter((p: { scope: string }) => p.scope === 'global')
    expect(global.length).toBeGreaterThan(0)
  })
})
