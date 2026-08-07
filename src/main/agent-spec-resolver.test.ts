import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// tm-agent-spec is the ONLY implementation of contract resolution — the app
// never reads contracts, so there is deliberately no TypeScript mirror to test
// instead. Run the real script.

const SCRIPT = join(import.meta.dir, '..', '..', 'plugin', 'bin', 'tm-agent-spec')

let base: string
let repo: string
let pluginBin: string

const run = (args: string[]) =>
  execFileSync(pluginBin, args, { cwd: repo, encoding: 'utf8' }).trim()

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-spec-')))
  repo = join(base, 'repo')
  // A throwaway plugin tree: the script resolves its own directory, so it must
  // be run from inside one rather than from the source checkout.
  const plugin = join(base, 'plugin')
  pluginBin = join(plugin, 'bin', 'tm-agent-spec')
  mkdirSync(join(plugin, 'bin'), { recursive: true })
  mkdirSync(join(plugin, 'agents'), { recursive: true })
  mkdirSync(join(repo, '.agents'), { recursive: true })
  execFileSync('cp', [SCRIPT, pluginBin])
  execFileSync('git', ['init', '-q'], { cwd: repo })

  for (const k of ['drift', 'health', 'testing'])
    writeFileSync(join(plugin, 'agents', `${k}.md`), `# default ${k}\n`)
  // The repo overrides one and adds one of its own.
  writeFileSync(join(repo, '.agents', 'drift.md'), '# ours\n')
  writeFileSync(join(repo, '.agents', 'house-style.md'), '# ours\n')
  // Non-contract siblings that must not be listed as kinds.
  writeFileSync(join(repo, '.agents', 'drift.sh'), '#!/bin/sh\n')
  writeFileSync(join(repo, '.agents', 'owned.yml'), 'x: 1\n')
})

afterAll(() => base && rmSync(base, { recursive: true, force: true }))

describe('tm-agent-spec', () => {
  test('falls back to the shipped default', () => {
    expect(run(['health'])).toEndWith('/plugin/agents/health.md')
  })

  test("the repo's own contract wins", () => {
    expect(run(['drift'])).toBe(join(repo, '.agents', 'drift.md'))
  })

  test('exits non-zero for a kind neither layer has', () => {
    expect(() => run(['nope'])).toThrow()
  })

  test.each(['../escape', 'a/b', ''])('refuses %p', (kind) => {
    expect(() => run([kind])).toThrow()
  })

  // The first version derived this list from `dirname $(tm-agent-spec drift)`,
  // which silently drops every plugin default the moment `drift` is the kind a
  // repo happens to override — exactly the case here.
  test('--list unions both layers, even when the probed kind is overridden', () => {
    expect(run(['--list']).split('\n')).toEqual(['drift', 'health', 'house-style', 'testing'])
  })

  test('--list reports each kind once, and only markdown', () => {
    const kinds = run(['--list']).split('\n')
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds).not.toContain('owned')
    expect(kinds).not.toContain('drift.sh')
  })

  // The app symlinks the script into ~/.config/TerMinal/bin (linkStateResolvers)
  // and every caller invokes it bare off PATH. `dirname $0` of the SYMLINK is
  // that bin dir, so without physical $0 resolution the plugin dir resolved to
  // ~/.config/TerMinal — no agents/ — and every shipped default vanished.
  test('resolves plugin defaults when invoked THROUGH the installed symlink', () => {
    const linkDir = join(base, 'installed-bin')
    mkdirSync(linkDir, { recursive: true })
    const link = join(linkDir, 'tm-agent-spec')
    execFileSync('ln', ['-sf', pluginBin, link])
    const viaLink = (args: string[]) =>
      execFileSync(link, args, { cwd: repo, encoding: 'utf8' }).trim()
    expect(viaLink(['health'])).toBe(join(base, 'plugin', 'agents', 'health.md'))
    expect(viaLink(['--list']).split('\n')).toContain('health')
  })

  // Under `set -euo pipefail` the group's last pipeline used to fail whenever
  // the repo had no .agents/ — correct listing on stdout, exit code 1, and any
  // strict-mode caller treated the listing as a failure.
  test('--list exits 0 outside a repo / without a repo .agents dir', () => {
    const bare = join(base, 'no-agents')
    mkdirSync(bare, { recursive: true })
    const out = execFileSync(pluginBin, ['--list'], { cwd: bare, encoding: 'utf8' }).trim()
    expect(out.split('\n')).toContain('health')
  })
})
