import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Ticket 0123. `inbox:*` is the canonical channel family; `hitl:*` is the
// pre-rename spelling, kept forever.
//
// An alias is only worth having if it cannot drift. The failure this guards is
// silent and nasty: someone fixes a bug in `inbox:resolve`, leaves `hitl:resolve`
// pointing at an older inline body, and every caller still on the old channel
// quietly gets the old behaviour. So the assertion is not "both channels exist"
// — it is "both channels delegate to the SAME named implementation".
//
// Source analysis rather than `await import()`: this module transitively imports
// electron, which does not load under `bun test`. Same constraint (and same
// technique) as registrars.test.ts.

const DIR = import.meta.dir
const SRC = readFileSync(join(DIR, 'inbox-items.ts'), 'utf8')
const PRELOAD = readFileSync(join(DIR, '..', '..', 'preload', 'index.ts'), 'utf8')
const TYPES = readFileSync(join(DIR, '..', '..', 'renderer', 'src', 'lib', 'types.ts'), 'utf8')

/** Channel → the implementation identifier its handler body calls. */
function registrations(prefix: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = new RegExp(`handle\\(\\s*'${prefix}:([^']+)'[\\s\\S]*?=>\\s*\\n?\\s*(\\w+)\\(`, 'g')
  for (const m of SRC.matchAll(re)) out.set(m[1], m[2])
  return out
}

const canonical = registrations('inbox')
const aliases = registrations('hitl')

describe('inbox:* is the canonical family (ticket 0123)', () => {
  test('it covers every item operation', () => {
    expect([...canonical.keys()].sort()).toEqual([
      'list',
      'mark-all-read',
      'mark-read',
      'remote-all',
      'remove',
      'resolve',
    ])
  })

  test('the preload invokes it from gt.inbox', () => {
    for (const suffix of canonical.keys()) {
      expect(PRELOAD, `gt.inbox should invoke inbox:${suffix}`).toContain(
        `invoke('inbox:${suffix}'`,
      )
    }
  })

  test('GtApi declares the item methods on inbox, not only on hitl', () => {
    // The generated channel map reads each channel's shape off GtApi through
    // the preload key that invokes it. A method missing here makes the channel
    // untypeable, so this is what keeps `inbox:*` a first-class family rather
    // than a second spelling nobody can call.
    const inboxBlock = TYPES.slice(TYPES.indexOf('  inbox: {'), TYPES.indexOf('  agentview: {'))
    for (const name of ['list', 'remoteAll', 'resolve', 'remove', 'markRead', 'markAllRead']) {
      expect(inboxBlock, `GtApi.inbox.${name} is missing`).toContain(`${name}:`)
    }
  })
})

describe('hitl:* is a permanent alias that cannot drift (ticket 0123)', () => {
  test('every canonical channel has an alias', () => {
    expect([...aliases.keys()].sort()).toEqual([...canonical.keys()].sort())
  })

  test('each alias delegates to the same implementation as its canonical twin', () => {
    // THE test. Re-inlining a body under `hitl:` instead of calling the shared
    // function is exactly how the two spellings start behaving differently.
    for (const [suffix, impl] of canonical) {
      expect(aliases.get(suffix), `hitl:${suffix} must call ${impl}()`).toBe(impl)
    }
  })

  test('the aliases are not just re-exported names — they resolve to real work', () => {
    // Guards against the delegation target being a stub: each implementation
    // name must be defined in this module.
    for (const impl of new Set(canonical.values())) {
      expect(SRC, `${impl} should be defined here`).toContain(`const ${impl} =`)
    }
  })

  test('gt.hitl still exists in the preload and the API surface', () => {
    // Dropping it is the back-compat break the alias policy exists to prevent.
    expect(PRELOAD).toContain("invoke('hitl:list'")
    expect(TYPES).toContain('  hitl: {')
  })
})

describe('the state area was NOT renamed (ADR-0020)', () => {
  test('the module says so, because the asymmetry is surprising', () => {
    // Concept renamed, disk layout kept: hitl.json has five out-of-app writers
    // (terminal-cli, terminal-cron, terminal-mcp-server, the app, remote hosts).
    expect(SRC).toMatch(/state area on disk stays `hitl`/)
  })
})
