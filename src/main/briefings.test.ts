import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every test writes into a fresh mkdtemp root and points the module's two env
// seams at it. Nothing here may touch the real ~/.config/TerMinal.
const roots: string[] = []

function tempRoot(): { briefings: string; agentState: string } {
  const root = mkdtempSync(join(tmpdir(), 'tm-briefings-'))
  roots.push(root)
  const briefings = join(root, 'briefings')
  const agentState = join(root, 'agent-state')
  mkdirSync(briefings, { recursive: true })
  mkdirSync(agentState, { recursive: true })
  process.env.TERMINAL_BRIEFINGS_DIR = briefings
  process.env.TERMINAL_AGENT_STATE_DIR = agentState
  return { briefings, agentState }
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
  delete process.env.TERMINAL_BRIEFINGS_DIR
  delete process.env.TERMINAL_AGENT_STATE_DIR
})

const SAMPLE = `---
kind: briefing
date: 2026-07-31
generated: 2026-07-31T08:00:00Z
items: 3
status: ok
---

# Morning briefing — 2026-07-31

Two PRs opened overnight and one idea proposed.

## Items

### [pr] Backfill 6 tests in ticket-provider
- agent: coverage
- repo: TerMinal
- link: https://github.com/trevormil/TerMinal/pull/201
- nav: mrs
- detail: Coverage rose 72.1% to 74.8%.

### [idea] Cache invalidation test for the workspace daemon
- agent: ticket-ideas
- repo: TerMinal
- ledgerKey: workspace-daemon-cache-invalidation
- link: ticket:0130
- nav: tickets
- detail: Proposed as horizon:future.

### [run] deps-quality failed on beacon
- agent: deps-quality
- repo: beacon
- nav: runs
- detail: bun audit exited 1.
`

describe('parseBriefing', () => {
  test('extracts frontmatter, summary prose, and every item with its fields', async () => {
    const { parseBriefing } = await import('./briefings')
    const b = parseBriefing(SAMPLE, '2026-07-31', '/tmp/x.md')

    expect(b.date).toBe('2026-07-31')
    expect(b.status).toBe('ok')
    expect(b.summary).toBe('Two PRs opened overnight and one idea proposed.')
    expect(b.items).toHaveLength(3)

    expect(b.items[0]).toMatchObject({
      kind: 'pr',
      title: 'Backfill 6 tests in ticket-provider',
      agent: 'coverage',
      repo: 'TerMinal',
      link: 'https://github.com/trevormil/TerMinal/pull/201',
      nav: 'mrs',
      detail: 'Coverage rose 72.1% to 74.8%.',
    })
    expect(b.items[1]).toMatchObject({
      kind: 'idea',
      agent: 'ticket-ideas',
      ledgerKey: 'workspace-daemon-cache-invalidation',
      link: 'ticket:0130',
    })
    expect(b.items[2]).toMatchObject({ kind: 'run', repo: 'beacon' })
    // ledgerKey is genuinely absent, not an empty string — dismiss write-back
    // branches on it.
    expect(b.items[2].ledgerKey).toBeUndefined()
  })

  test('ids are unique within a briefing', async () => {
    const { parseBriefing } = await import('./briefings')
    const b = parseBriefing(SAMPLE, '2026-07-31', '/x')
    expect(new Set(b.items.map((i) => i.id)).size).toBe(3)
  })

  test('an item keeps its id when OTHER items are inserted above it', async () => {
    // The real hazard, and the reason ordinal ids are wrong: a forced re-run
    // reorders the list, `pr-2` now names a different item, and a verdict
    // recorded yesterday silently lands on the wrong row. If that row carried a
    // ledgerKey, Dismiss would then write the WRONG key — permanently
    // suppressing an idea the human never rejected, with no audit trail.
    const { parseBriefing } = await import('./briefings')
    const before = parseBriefing(SAMPLE, '2026-07-31', '/x')

    const withExtra = SAMPLE.replace(
      '## Items\n',
      `## Items

### [pr] A brand new PR that landed first
- agent: coverage
- repo: TerMinal
`,
    )
    const after = parseBriefing(withExtra, '2026-07-31', '/x')
    expect(after.items).toHaveLength(4)

    // Every item that existed before must still carry the same id.
    for (const old of before.items) {
      const match = after.items.find((i) => i.title === old.title)
      expect(match).toBeTruthy()
      expect(match!.id).toBe(old.id)
    }
  })

  test('ids are derived from the title, so they survive a reorder', async () => {
    const { parseBriefing } = await import('./briefings')
    const a = parseBriefing(SAMPLE, '2026-07-31', '/x')
    // Same three items, reversed order in the file.
    const blocks = SAMPLE.split('### ').slice(1).reverse()
    const reordered =
      SAMPLE.slice(0, SAMPLE.indexOf('### ')) + blocks.map((b) => `### ${b}`).join('')
    const b = parseBriefing(reordered, '2026-07-31', '/x')

    for (const item of a.items) {
      expect(b.items.find((i) => i.title === item.title)!.id).toBe(item.id)
    }
  })

  test('an unknown [kind] tag degrades to note rather than dropping the item', async () => {
    const { parseBriefing } = await import('./briefings')
    const b = parseBriefing(
      `---\ndate: 2026-01-01\n---\n\n## Items\n\n### [wat] Something new\n- repo: x\n`,
      '2026-01-01',
      '/x',
    )
    expect(b.items).toHaveLength(1)
    expect(b.items[0]).toMatchObject({ kind: 'note', title: 'Something new' })
  })

  test('a briefing with no Items section parses to zero items, not a throw', async () => {
    const { parseBriefing } = await import('./briefings')
    const b = parseBriefing(
      `---\ndate: 2026-01-01\nstatus: ok\n---\n\nNothing happened.\n`,
      '2026-01-01',
      '/x',
    )
    expect(b.items).toEqual([])
    expect(b.summary).toBe('Nothing happened.')
  })

  test('garbage input does not throw', async () => {
    const { parseBriefing } = await import('./briefings')
    expect(() => parseBriefing('', '2026-01-01', '/x')).not.toThrow()
    expect(parseBriefing('### [pr] orphan heading', '2026-01-01', '/x').items).toEqual([])
  })
})

describe('latestBriefing', () => {
  test('picks the newest date, not the newest mtime', async () => {
    const { briefings } = tempRoot()
    // Write the OLDER date LAST so mtime ordering and date ordering disagree.
    writeFileSync(join(briefings, '2026-07-30.md'), SAMPLE.replace('2026-07-31', '2026-07-30'))
    writeFileSync(join(briefings, '2026-07-29.md'), SAMPLE.replace('2026-07-31', '2026-07-29'))
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    writeFileSync(join(briefings, '2026-07-28.md'), SAMPLE.replace('2026-07-31', '2026-07-28'))

    const { latestBriefing } = await import(`./briefings.ts?t=${Date.now()}-a`)
    expect(latestBriefing()?.date).toBe('2026-07-31')
  })

  test('returns null when the directory is missing or empty', async () => {
    tempRoot()
    const { latestBriefing } = await import(`./briefings.ts?t=${Date.now()}-b`)
    expect(latestBriefing()).toBeNull()
  })

  test('ignores non-date filenames', async () => {
    const { briefings } = tempRoot()
    writeFileSync(join(briefings, 'README.md'), '# not a briefing')
    writeFileSync(join(briefings, 'notes.txt'), 'x')
    const { latestBriefing } = await import(`./briefings.ts?t=${Date.now()}-c`)
    expect(latestBriefing()).toBeNull()
  })
})

describe('actOnBriefingItem', () => {
  test('dismissing an idea appends its key to the producing agent ledger', async () => {
    const { briefings, agentState } = tempRoot()
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    const { latestBriefing, actOnBriefingItem } = await import(`./briefings.ts?t=${Date.now()}-d`)

    const idea = latestBriefing()!.items.find(
      (i: { kind: string; id: string }) => i.kind === 'idea',
    )!
    const r = actOnBriefingItem('2026-07-31', idea.id, 'dismissed')
    expect(r.ok).toBe(true)

    const ledger = JSON.parse(
      readFileSync(join(agentState, 'TerMinal', 'ticket-ideas.dismissed.json'), 'utf8'),
    )
    expect(ledger.dismissed).toHaveLength(1)
    expect(ledger.dismissed[0].key).toBe('workspace-daemon-cache-invalidation')
    expect(ledger.dismissed[0].at).toBeGreaterThan(0)
    // The agent's own array must be left completely alone — the two writers
    // never touch each other's key.
    expect(ledger.proposedIdeas).toBeUndefined()
  })

  test('dismiss appends to existing dismissals without clobbering them', async () => {
    const { briefings, agentState } = tempRoot()
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    mkdirSync(join(agentState, 'TerMinal'), { recursive: true })
    writeFileSync(
      join(agentState, 'TerMinal', 'ticket-ideas.dismissed.json'),
      JSON.stringify({ dismissed: [{ key: 'older-thing', at: 1 }] }),
    )
    const { latestBriefing, actOnBriefingItem } = await import(`./briefings.ts?t=${Date.now()}-e`)
    const idea = latestBriefing()!.items.find(
      (i: { kind: string; id: string }) => i.kind === 'idea',
    )!
    actOnBriefingItem('2026-07-31', idea.id, 'dismissed')

    const ledger = JSON.parse(
      readFileSync(join(agentState, 'TerMinal', 'ticket-ideas.dismissed.json'), 'utf8'),
    )
    expect(ledger.dismissed.map((d: { key: string }) => d.key)).toEqual([
      'older-thing',
      'workspace-daemon-cache-invalidation',
    ])
  })

  test("the app NEVER writes the agent's own state file", async () => {
    // The whole point of the two-file split: both sides read-modify-write the
    // whole document, so sharing a file means a 04:00 run and a 04:00 Dismiss
    // silently revert each other — potentially rolling back lastScannedSha.
    const { briefings, agentState } = tempRoot()
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    mkdirSync(join(agentState, 'TerMinal'), { recursive: true })
    const agentFile = join(agentState, 'TerMinal', 'ticket-ideas.json')
    const agentOwned = JSON.stringify({
      lastScannedSha: 'abc123',
      proposedIdeas: [{ key: 'workspace-daemon-cache-invalidation', ticket: '0130', at: 1 }],
    })
    writeFileSync(agentFile, agentOwned)

    const { latestBriefing, actOnBriefingItem } = await import(`./briefings.ts?t=${Date.now()}-e2`)
    const idea = latestBriefing()!.items.find(
      (i: { kind: string; id: string }) => i.kind === 'idea',
    )!
    actOnBriefingItem('2026-07-31', idea.id, 'dismissed')

    // Byte-identical: not merely "the fields survived", but "never touched".
    expect(readFileSync(agentFile, 'utf8')).toBe(agentOwned)
  })

  test('dismissing the same key twice does not double-append', async () => {
    const { briefings, agentState } = tempRoot()
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    const { latestBriefing, actOnBriefingItem } = await import(`./briefings.ts?t=${Date.now()}-f`)
    const idea = latestBriefing()!.items.find(
      (i: { kind: string; id: string }) => i.kind === 'idea',
    )!
    actOnBriefingItem('2026-07-31', idea.id, 'dismissed')
    actOnBriefingItem('2026-07-31', idea.id, 'dismissed')
    const ledger = JSON.parse(
      readFileSync(join(agentState, 'TerMinal', 'ticket-ideas.dismissed.json'), 'utf8'),
    )
    expect(ledger.dismissed).toHaveLength(1)
  })

  test('an item with no ledgerKey is still recorded, but writes no ledger', async () => {
    const { briefings, agentState } = tempRoot()
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    const { latestBriefing, actOnBriefingItem } = await import(`./briefings.ts?t=${Date.now()}-g`)
    const run = latestBriefing()!.items.find((i: { kind: string; id: string }) => i.kind === 'run')!
    expect(actOnBriefingItem('2026-07-31', run.id, 'dismissed').ok).toBe(true)
    // deps-quality has no ledgerKey on this item, so no ledger file is created.
    expect(() =>
      readFileSync(join(agentState, 'beacon', 'deps-quality.dismissed.json'), 'utf8'),
    ).toThrow()
  })

  test('verdicts persist in a sidecar and are reflected on the next read', async () => {
    const { briefings } = tempRoot()
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    const mod = await import(`./briefings.ts?t=${Date.now()}-h`)

    const before = mod.latestBriefing()!
    expect(before.items.every((i: { verdict?: string }) => !i.verdict)).toBe(true)

    mod.actOnBriefingItem('2026-07-31', before.items[0].id, 'promoted')
    mod.actOnBriefingItem('2026-07-31', before.items[1].id, 'dismissed')

    const after = mod.latestBriefing()!
    expect(after.items[0].verdict).toBe('promoted')
    expect(after.items[1].verdict).toBe('dismissed')
    expect(after.items[2].verdict).toBeUndefined()
  })

  test('the agent-authored markdown is never rewritten by an act', async () => {
    const { briefings } = tempRoot()
    const path = join(briefings, '2026-07-31.md')
    writeFileSync(path, SAMPLE)
    const mod = await import(`./briefings.ts?t=${Date.now()}-i`)
    mod.actOnBriefingItem('2026-07-31', mod.latestBriefing()!.items[0].id, 'promoted')
    expect(readFileSync(path, 'utf8')).toBe(SAMPLE)
  })

  test('an array-shaped verdicts file does not silently swallow verdicts', async () => {
    // `typeof [] === 'object'`, and a string key set on an array is dropped by
    // JSON.stringify — so this used to return ok, show the verdict optimistically,
    // and revert on the next reload with no error anywhere.
    const { briefings } = tempRoot()
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    writeFileSync(join(briefings, '2026-07-31.verdicts.json'), '[]')

    const mod = await import(`./briefings.ts?t=${Date.now()}-arr`)
    const first = mod.latestBriefing()!.items[0]
    expect(mod.actOnBriefingItem('2026-07-31', first.id, 'promoted').ok).toBe(true)
    // The verdict must actually survive a reload.
    expect(
      mod.latestBriefing()!.items.find((i: { id: string }) => i.id === first.id)!.verdict,
    ).toBe('promoted')
  })

  test('an unknown item id is an error, not a silent no-op', async () => {
    const { briefings } = tempRoot()
    writeFileSync(join(briefings, '2026-07-31.md'), SAMPLE)
    const mod = await import(`./briefings.ts?t=${Date.now()}-j`)
    expect(mod.actOnBriefingItem('2026-07-31', 'nope', 'promoted')).toMatchObject({
      ok: false,
    })
  })

  test('an unknown date is an error, not a throw', async () => {
    tempRoot()
    const mod = await import(`./briefings.ts?t=${Date.now()}-k`)
    expect(mod.actOnBriefingItem('2099-01-01', 'x', 'promoted').ok).toBe(false)
  })

  test('a path-traversing date is rejected before any file access', async () => {
    tempRoot()
    const mod = await import(`./briefings.ts?t=${Date.now()}-l`)
    expect(mod.actOnBriefingItem('../../etc/passwd', 'x', 'promoted').ok).toBe(false)
  })
})
