import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateChannelMapSource, parseBindings } from './ipc-channels.gen'

// `ipc-channels.ts` is generated from the preload. A generated file that nobody
// regenerates is worse than a hand-written one: it looks authoritative while
// describing a preload from three months ago. These assertions make the drift
// fail the suite instead.

const DIR = import.meta.dir
const PRELOAD_SRC = readFileSync(join(DIR, '..', 'preload', 'index.ts'), 'utf8')
const CHECKED_IN = readFileSync(join(DIR, 'ipc-channels.ts'), 'utf8')

describe('generated channel map', () => {
  test('the parser found the gt surface', () => {
    // An empty parse would make the map an empty type, which silently accepts
    // nothing and would be caught only by 248 confusing tsc errors.
    const bindings = parseBindings(PRELOAD_SRC)
    expect(bindings.length).toBeGreaterThan(200)
    expect(bindings).toContainEqual({ path: ['settings', 'patch'], channel: 'settings:patch' })
    expect(bindings).toContainEqual({ path: ['pickDir'], channel: 'dialog:pickDir' })
    expect(bindings).toContainEqual({
      path: ['persistentAgents', 'files', 'list'],
      channel: 'persistent-agents:files-list',
    })
  })

  test('no two preload keys claim the same channel', () => {
    // The failure this catches is silent and worse than a missing entry: a leaf
    // that swallows the next line claims a channel it never invokes, and the
    // map then types that channel against the WRONG key's signature. `mrs:ci`
    // was bound to `onDigestStatus`, whose signature is a subscription.
    const byChannel = new Map<string, string[]>()
    for (const b of parseBindings(PRELOAD_SRC)) {
      byChannel.set(b.channel, [...(byChannel.get(b.channel) ?? []), b.path.join('.')])
    }
    expect([...byChannel].filter(([, keys]) => keys.length > 1)).toEqual([])
  })

  test('a subscription key claims no channel — it invokes nothing', () => {
    const paths = parseBindings(PRELOAD_SRC).map((b) => b.path.join('.'))
    expect(paths).not.toContain('onDigestStatus')
    expect(paths).toContain('getMrCi')
  })

  test('every channel the preload invokes is in the map', () => {
    // The parser walks structure; this cross-checks it against a dumb scan of
    // the same file, so a leaf the depth tracker mis-nested cannot go missing.
    const invoked = new Set(
      [...PRELOAD_SRC.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]),
    )
    const mapped = new Set(parseBindings(PRELOAD_SRC).map((b) => b.channel))
    expect([...invoked].filter((c) => !mapped.has(c)).sort()).toEqual([])
  })

  test('the checked-in map is what the generator produces today', () => {
    // Fails when the preload gains, renames or drops a key. Fix by running
    // `bun src/main/ipc-channels.gen.ts`.
    expect(CHECKED_IN).toBe(generateChannelMapSource(PRELOAD_SRC))
  })
})
