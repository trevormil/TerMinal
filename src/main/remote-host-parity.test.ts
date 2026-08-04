import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOTSTRAP_MARKER_LABELS } from './bootstrap'

// remote-host-script.cjs is a self-contained copy of logic the app also runs
// locally — it ships to remote hosts, so it can't import from src/. That makes
// it a silent drift vector: when the tm plugin moved Claude skills out of
// repos, bootstrap.ts dropped the .claude/skills marker and the remote copy
// kept it, so remote repos read "partial" forever. Pin the two together.

const SCRIPT = readFileSync(join(import.meta.dir, 'remote-host-script.cjs'), 'utf8')

describe('remote host script parity', () => {
  test('bootstrap markers match the local classifier', () => {
    const block = SCRIPT.match(/const markers = \[([\s\S]*?)\n {2}\]/)
    expect(block).not.toBeNull()
    const remoteLabels = [...block![1].matchAll(/label: '([^']+)'/g)].map((m) => m[1])
    expect(remoteLabels).toEqual([...BOOTSTRAP_MARKER_LABELS])
  })

  test('does not reference per-repo Claude machinery the plugin now owns', () => {
    const offenders = SCRIPT.split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, l]) => /\.claude\/(skills|bin|hooks)\//.test(l))
      .map(([n, l]) => `${n}: ${l.trim()}`)
    expect(offenders).toEqual([])
  })
})
