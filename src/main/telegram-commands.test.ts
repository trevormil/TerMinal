import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMAND_SPECS, HELP_TEXT, commandIndex, nlCommandList } from './telegram-commands'

// Ticket 91. telegram.ts carried three hand-maintained copies of "which
// commands exist": the dispatcher switch, the /help text, and the natural-
// language translator's command list. They drift — that is not a hypothesis,
// it is what hand-maintained parallel lists do. One COMMAND_SPECS table now
// feeds all three, and this file is the sync test that keeps it that way.

describe('COMMAND_SPECS is internally sound', () => {
  test('every command token is unique across cmds and aliases', () => {
    const seen = new Set<string>()
    for (const spec of COMMAND_SPECS)
      for (const c of spec.cmds) {
        expect(seen.has(c), `${c} is claimed twice`).toBe(false)
        seen.add(c)
      }
  })

  test('tokens are slash-lowercase', () => {
    for (const spec of COMMAND_SPECS) for (const c of spec.cmds) expect(c).toMatch(/^\/[a-z-]+$/)
  })

  test('commandIndex resolves aliases to the same spec as the primary', () => {
    const idx = commandIndex()
    expect(idx.get('/prs')).toBe(idx.get('/mrs'))
    expect(idx.get('/pr')).toBe(idx.get('/mr'))
    expect(idx.get('/start')).toBe(idx.get('/help'))
    expect(idx.get('/whoami')).toBe(idx.get('/about'))
  })
})

describe('the help text stays in sync (drift direction 1)', () => {
  test('every dispatchable command is advertised in /help', () => {
    // /help itself is the one exception — it IS the help.
    for (const spec of COMMAND_SPECS) {
      if (spec.cmds[0] === '/help') continue
      expect(HELP_TEXT.includes(spec.cmds[0]), `${spec.cmds[0]} missing from HELP_TEXT`).toBe(true)
    }
  })

  test('every command the help advertises actually dispatches', () => {
    const idx = commandIndex()
    for (const token of HELP_TEXT.match(/\/[a-z-]+/g) ?? []) {
      expect(idx.has(token), `help advertises ${token} but nothing dispatches it`).toBe(true)
    }
  })
})

describe('the NL translator prompt stays in sync (drift direction 2)', () => {
  test('the command list is generated from the table, and every line dispatches', () => {
    const idx = commandIndex()
    for (const line of nlCommandList().split('\n')) {
      const token = line.trim().split(/\s+/)[0]
      expect(token.startsWith('/')).toBe(true)
      expect(idx.has(token), `NL prompt offers ${token} but nothing dispatches it`).toBe(true)
    }
  })
})

describe('the dispatcher stays in sync (drift direction 3)', () => {
  // telegram.ts binds handlers by primary token. Source-level, because
  // importing telegram.ts drags in the electron-adjacent runtime; the repo
  // already blesses this style (cert-trust, agent-entry-parity).
  const src = readFileSync(join(import.meta.dir, 'telegram.ts'), 'utf8')

  test('every spec has a bound handler in telegram.ts', () => {
    for (const spec of COMMAND_SPECS) {
      expect(src.includes(`'${spec.cmds[0]}':`), `no handler bound for ${spec.cmds[0]}`).toBe(true)
    }
  })

  test('the old parallel switch is gone', () => {
    expect(src.includes("case '/help':")).toBe(false)
  })
})
