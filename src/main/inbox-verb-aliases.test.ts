import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

// Ticket 0123. The agent-facing verbs speak Inbox now; the HITL spellings stay
// forever as aliases.
//
// Both files are self-contained scripts (copied to remote hosts, no sibling
// modules), so they cannot be imported here — the CLI dispatches on
// `process.argv` at load and the MCP server opens stdio. Source analysis is the
// same technique src/main/inbox-category-wiring.test.ts already uses on them.
//
// What matters is not that the new names EXIST but that they reach the same
// implementation: a generic verb wired to a second, subtly different code path
// is worse than no generic verb at all.

const ROOT = resolve(import.meta.dir, '../..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const CLI = read('bin/terminal-cli')
const MCP = read('bin/terminal-mcp-server')

describe('terminal-cli: inbox-item is the documented verb (ticket 0123)', () => {
  // The dispatch arm both verbs share. `hitl` must stay the LAST case label of
  // the pair so the slice inbox-category-wiring.test.ts takes still finds the
  // body — two tests reading the same switch, deliberately.
  const arm = CLI.slice(CLI.indexOf("case 'inbox-item':"), CLI.indexOf("case 'monitor':"))

  test('the generic verb exists', () => {
    expect(CLI).toContain("case 'inbox-item':")
  })

  test('hitl falls through to the SAME arm — not a copy of it', () => {
    // A duplicated arm is how `--category` ends up parsed by one spelling and
    // dropped by the other.
    expect(arm).toContain("case 'hitl':")
    expect(arm.match(/fileHitl\(/g) ?? []).toHaveLength(1)
  })

  test('both spellings appear in --help, with hitl marked as the alias', () => {
    const help = CLI.slice(0, CLI.indexOf('import '))
    expect(help).toContain('inbox-item')
    expect(help).toMatch(/hitl[^\n]*alias/i)
  })

  test('the usage line offers the generic verb', () => {
    // The error a user actually reads when they get the verb wrong.
    // lastIndexOf: `monitor` prints its own usage line earlier in the file.
    const start = CLI.lastIndexOf('usage: terminal-cli')
    const usage = CLI.slice(start, CLI.indexOf('\n    )\n', start))
    expect(usage).toContain('inbox-item')
    // …and still names the alias, so an old script's author is not told their
    // working command is invalid.
    expect(usage).toMatch(/hitl[^\n]*alias/i)
  })

  test('`inbox` still means the automation listener queue', () => {
    // The name was already taken (terminal-cli inbox enqueue/status/dir). Hijacking
    // it for item filing would silently break every listener caller, which is why
    // the item verb is `inbox-item` rather than `inbox`.
    expect(CLI).toContain("case 'inbox':")
    const listenerArm = CLI.slice(CLI.indexOf("case 'listener':"), CLI.indexOf("case 'state':"))
    expect(listenerArm).toContain('listenerCommand')
  })
})

describe('terminal-mcp-server: inbox tools alias the hitl tools (ticket 0123)', () => {
  const PAIRS: [string, string][] = [
    ['file_inbox_item', 'file_hitl'],
    ['list_inbox', 'list_hitl'],
    ['resolve_inbox_item', 'resolve_hitl'],
  ]

  /** `name: handlerFn` out of the HANDLERS table. */
  const handlerFor = (tool: string): string | undefined =>
    MCP.match(new RegExp(`\\n\\s*${tool}:\\s*(\\w+),`))?.[1]

  for (const [generic, legacy] of PAIRS) {
    test(`${generic} dispatches to the same handler as ${legacy}`, () => {
      const fn = handlerFor(generic)
      expect(fn, `${generic} is not in the HANDLERS table`).toBeTruthy()
      expect(handlerFor(legacy), `${legacy} must stay callable`).toBe(fn!)
    })

    test(`${generic} is advertised in the tool list`, () => {
      // An alias nobody can discover is not the documented path.
      expect(MCP).toContain(`name: '${generic}'`)
    })

    test(`${legacy} stays advertised too, marked as the alias`, () => {
      // Removing the schema would break a client that validates names against
      // the advertised list before calling.
      const schema = MCP.slice(MCP.indexOf(`name: '${legacy}'`))
      expect(schema.slice(0, 400)).toMatch(/alias/i)
    })
  }

  test('the lean presets carry the generic names', () => {
    // Presets exist to cut schema tokens. Listing both spellings there would
    // spend the tokens the preset is meant to save.
    const presets = MCP.slice(
      MCP.indexOf('const TOOL_PRESETS'),
      MCP.indexOf('function exposedTools'),
    )
    expect(presets).toContain('file_inbox_item')
    expect(presets).toContain('list_inbox')
    expect(presets).toContain('resolve_inbox_item')
  })

  test('file_inbox_item advertises the free-form category', () => {
    // Categories are what make the Inbox generic (ticket 120); a filing tool
    // that cannot name one leaves every MCP-filed item Uncategorized.
    const schema = MCP.slice(
      MCP.indexOf("name: 'file_inbox_item'"),
      MCP.indexOf("name: 'resolve_inbox_item'"),
    )
    expect(schema).toContain('category:')
  })
})

describe('plugin/bin: the shipped helper is spelled inbox-item too (ticket 0123)', () => {
  const HELPER = join(ROOT, 'plugin', 'bin', 'inbox-item')

  test('it exists and is executable — agents invoke it by path', () => {
    // The whole plugin/bin directory is copied into ~/.config/TerMinal at
    // install; a helper that lands without its exec bit is "permission denied"
    // at the exact moment an agent is trying to report a blocker.
    expect(statSync(HELPER).mode & 0o111).toBeGreaterThan(0)
  })

  test('it delegates to the sibling hitl script rather than re-implementing it', () => {
    // Two scripts writing hitl.json is two places to get the lock, the dedup
    // and the Telegram fallback subtly different.
    const src = readFileSync(HELPER, 'utf8')
    expect(src).toMatch(/exec\s+"\$\(dirname "\$0"\)\/hitl"\s+"\$@"/)
  })

  test('running it with no arguments still prints usage instead of filing junk', () => {
    // Cheap end-to-end proof the delegation actually resolves — a broken
    // `dirname` path would fail here, not in the grep above.
    const out = spawnSync(HELPER, [], { encoding: 'utf8' })
    expect(out.stderr + out.stdout).toContain('usage:')
    // Always exits 0 by design: a filing helper must never fail an agent run.
    expect(out.status).toBe(0)
  })
})
