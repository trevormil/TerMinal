import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENTS, FORCE_PREAMBLE } from './agent-catalog'
import { isEngineId } from '../shared/engines'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Ticket 91, first extraction. The catalog is ~380 lines of hand-written data
// that ships on every repo and is spawned as real processes — so the failure
// mode is not a type error, it is an agent that silently never runs, or runs
// with an engine that no longer exists.
//
// It had NO tests before it was extracted: it was buried in the middle of
// agents.ts, where "the file is tested" quietly covered a data blob nothing
// asserted on.

describe('the built-in agent catalog is well-formed (ticket 91)', () => {
  test('it is not empty and did not shrink unnoticed', () => {
    // A bare `> 0` would pass if a bad merge dropped 30 of 31 agents.
    expect(DEFAULT_AGENTS.length).toBeGreaterThanOrEqual(25)
  })

  test('every id is unique', () => {
    // Duplicates do not error — the later one silently wins, and a user editing
    // the agent they can see changes the one they cannot.
    const ids = DEFAULT_AGENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every id is the kebab-case shape saveAgent enforces', () => {
    // Otherwise a shipped default cannot be re-saved after the user edits it —
    // the registry would reject its own catalog entry.
    for (const a of DEFAULT_AGENTS) {
      expect(a.id, `${a.id} is not kebab-case`).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    }
  })

  test('every agent has the fields the runner actually reads', () => {
    for (const a of DEFAULT_AGENTS) {
      expect(a.title?.trim(), `${a.id} has no title`).toBeTruthy()
      expect(a.prompt?.trim(), `${a.id} has no prompt`).toBeTruthy()
    }
  })

  test('every declared engine still exists in the registry', () => {
    // The sharpest rot risk: engines come and go (pi was added, opencode's
    // headless path is unwired). A catalog entry naming a dead engine spawns
    // nothing and reports no error.
    for (const a of DEFAULT_AGENTS) {
      if (a.engine === undefined) continue
      expect(isEngineId(a.engine), `${a.id} declares unknown engine "${a.engine}"`).toBe(true)
    }
  })

  test('FORCE agents are flagged, and NONE embeds the preamble in its prompt', () => {
    // FORCE is main-push authority, and the preamble granting it is prepended
    // at SPAWN time (agents.ts: `FORCE_PREAMBLE + contextPrompt`), not stored.
    // So a catalog prompt containing it would double up on a force agent — and
    // on a NON-force agent would be authority granted by accident, with no flag
    // anywhere to notice it by.
    const forced = DEFAULT_AGENTS.filter((a) => a.force)
    expect(forced.map((a) => a.id).sort()).toEqual(['emergency-fix', 'revert-main', 'unblock-ci'])
    for (const a of DEFAULT_AGENTS) {
      expect(a.prompt.includes('FORCE MODE'), `${a.id} embeds the preamble`).toBe(false)
    }
  })

  test('the spawn path is what prepends it, conditionally', () => {
    // The other half of the invariant above. If this ever becomes
    // unconditional, every agent silently gains main-push authority.
    const src = readFileSync(join(import.meta.dir, 'agents.ts'), 'utf8')
    expect(src).toMatch(/\?\s*FORCE_PREAMBLE \+ contextPrompt\s*:\s*contextPrompt/)
  })

  test('the preamble states the authority it grants', () => {
    expect(FORCE_PREAMBLE).toContain('TERMINAL_FORCE_MAIN=1')
    expect(FORCE_PREAMBLE).toMatch(/directly to main/i)
    // It must also bound it — authority with no scope is the whole risk.
    expect(FORCE_PREAMBLE).toMatch(/ONLY for the specific emergency/i)
  })

  test('the catalog is pure data — no imports with runtime cost', () => {
    // The point of the extraction. If this file starts importing the filesystem
    // or the registry, it stops being a config file and the cycle it was split
    // to avoid comes back.
    const text = readFileSync(join(import.meta.dir, 'agent-catalog.ts'), 'utf8')
    const imports = [...text.matchAll(/^import .*$/gm)].map((m) => m[0])
    expect(imports).toEqual(["import type { Agent } from './agent-types'"])
  })
})

describe('agents.ts still re-exports the catalog (ticket 91)', () => {
  test('existing importers keep working', () => {
    // ~40 modules import these from agents.ts. The refactor is only safe if it
    // did not quietly become a 40-file rename reviewed as one diff.
    //
    // Asserted at source level: importing agents.ts pulls in electron, and
    // mocking a browser process to prove a re-export line exists is more
    // machinery than the claim is worth.
    const src = readFileSync(join(import.meta.dir, 'agents.ts'), 'utf8')
    expect(src).toContain("export { DEFAULT_AGENTS, FORCE_PREAMBLE } from './agent-catalog'")
    expect(src).toContain("export type * from './agent-types'")
  })
})
