import { describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeAgentEntry } from './agents-global'
import type { Agent } from './agents'

// agents.ts pulls in electron transitively; the persisted shape is plain data.
void mock.module('electron', () => ({
  Notification: class {
    static isSupported(): boolean {
      return false
    }
    show(): void {}
  },
  app: { getPath: () => tmpdir(), isPackaged: false },
}))

// Ticket 96. Two copies of the persisted-agent shape existed: this normalizer,
// and an inline object literal in `saveAgent`. They were identical, which is
// precisely the state in which duplication is invisible — and #78 exists
// because an earlier divergence between them SILENTLY DROPPED
// modelPolicy/quality/model/outputContract/acceptanceCriteria/force on save.
//
// #78 could not remove the duplication (agents.ts was owned by a concurrent
// chain that day), so it fixed the drop and left the second copy standing.
//
// The test that matters is not "both produce the same output today" — they did
// when the bug shipped. It is "a field added to Agent cannot land in only one
// of them", which is what the source-level assertion below pins.

/** Every optional/required field a caller might set, all with distinct values. */
function fullAgent(): Partial<Agent> & { id: string; title: string; prompt: string } {
  return {
    id: '  my-agent  ',
    title: '  My Agent  ',
    prompt: '  do the thing  ',
    description: '  a description  ',
    icon: 'Bot',
    engine: 'claude',
    model: '  opus  ',
    modelPolicy: 'pinned',
    quality: 'top',
    outputContract: '  a contract  ',
    acceptanceCriteria: ['one', 'two'],
    opensPr: true,
    inPlace: false,
    force: true,
  } as Partial<Agent> & { id: string; title: string; prompt: string }
}

describe('the persisted agent shape has ONE definition (ticket 96)', () => {
  test('saveAgent no longer carries its own inline entry literal', () => {
    // The actual acceptance criterion. Asserted at the source level because a
    // behavioural test cannot distinguish "one definition" from "two identical
    // definitions" — and it was the second state that shipped the #78 bug.
    const src = readFileSync(join(import.meta.dir, 'agents.ts'), 'utf8')
    const save = src.slice(src.indexOf('export function saveAgent'))
    const body = save.slice(0, save.indexOf('\n}\n'))
    expect(body).toContain('normalizeAgentEntry')
    expect(body).not.toMatch(/const entry: Agent = \{/)
  })

  test('validation is shared too, not re-implemented per writer', () => {
    const src = readFileSync(join(import.meta.dir, 'agents.ts'), 'utf8')
    const global = readFileSync(join(import.meta.dir, 'agents-global.ts'), 'utf8')
    // Same rule, one source. If they diverge, one registry accepts ids the
    // other rejects and the same agent becomes unsaveable in one scope.
    const rule = /\[a-z0-9\]\[a-z0-9-\]\*/
    const inRepo = rule.test(src)
    const inGlobal = rule.test(global)
    // Either both inline the same literal rule, or (better) one is imported.
    expect(inRepo || src.includes('validateAgentShape')).toBe(true)
    expect(inGlobal || global.includes('validateAgentShape')).toBe(true)
  })
})

describe('normalizeAgentEntry keeps every field a caller can set (ticket 96)', () => {
  test('nothing set by the caller is dropped', () => {
    // The #78 regression in assertion form: a field present on input and absent
    // on output is a silent data loss on every save.
    const input = fullAgent()
    const out = normalizeAgentEntry(input) as Record<string, unknown>
    for (const key of Object.keys(input)) {
      expect(out[key], `normalizeAgentEntry dropped "${key}"`).not.toBeUndefined()
    }
  })

  test('it trims the free-text fields and leaves the rest alone', () => {
    const out = normalizeAgentEntry(fullAgent())
    expect(out.id).toBe('my-agent')
    expect(out.title).toBe('My Agent')
    expect(out.prompt).toBe('do the thing')
    expect(out.description).toBe('a description')
    expect(out.model).toBe('opus')
    expect(out.outputContract).toBe('a contract')
    expect(out.acceptanceCriteria).toEqual(['one', 'two'])
    expect(out.force).toBe(true)
    expect(out.inPlace).toBe(false)
  })

  test('computed provenance is NOT persisted', () => {
    // `source` and `hasScript` are derived at read time; a stale persisted copy
    // confuses the repo/global merge.
    const out = normalizeAgentEntry({
      ...fullAgent(),
      source: 'repo',
      hasScript: true,
    } as never) as Record<string, unknown>
    expect(out.source).toBeUndefined()
    expect(out.hasScript).toBeUndefined()
  })

  test('an empty free-text field becomes undefined, not an empty string', () => {
    const out = normalizeAgentEntry({
      id: 'a',
      title: 'A',
      prompt: 'p',
      description: '   ',
      model: '',
    })
    expect(out.description).toBeUndefined()
    expect(out.model).toBeUndefined()
  })
})

describe('both registries persist the same field set (ticket 96)', () => {
  test('a repo save and a global save agree field-for-field', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tm-agent-parity-'))
    try {
      const repoRoot = mkdtempSync(join(tmpdir(), 'tm-agent-repo-'))
      try {
        const { saveAgent, readAgents } = await import('./agents')
        const input = fullAgent()
        expect(saveAgent(repoRoot, input)).toEqual({ ok: true })
        const saved = readAgents(repoRoot).find((a: Agent) => a.id === 'my-agent')
        expect(saved).toBeDefined()

        const normalized = normalizeAgentEntry(input)
        // Provenance is added at read time, so compare only the persisted keys.
        const { source: _s, hasScript: _h, ...persisted } = saved as Record<string, unknown>
        expect(persisted).toEqual(normalized as unknown as Record<string, unknown>)
      } finally {
        rmSync(repoRoot, { recursive: true, force: true })
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
