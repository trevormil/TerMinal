import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Ticket 108. Test pollution of the operator's real state happened THREE times
// in one day, by three different actors, in three different ways. Each was
// fixed locally; the class was not closed.
//
// The seam already exists (`config-dir.ts`, resolved per call) and the bunfig
// preload already points the whole suite at a throwaway dir. Neither helps for
// code that never asks the seam — and 48 sites across 28 files built the path
// from `homedir()` directly, so the preload could not save them.
//
// This is the guard that makes it permanent. A grep-shaped test rather than a
// runtime one on purpose: the failure mode is a module resolving the real path
// at IMPORT time, which is before any runtime assertion in that module's own
// test file can possibly run.

const ROOT = resolve(import.meta.dir, '../..')
const SEAM = 'src/main/config-dir.ts'

/** Every non-test TypeScript source under src/. */
function sources(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      if (statSync(abs).isDirectory()) {
        if (name !== 'node_modules') walk(abs)
      } else if (
        (name.endsWith('.ts') || name.endsWith('.tsx')) &&
        !name.endsWith('.test.ts') &&
        !name.endsWith('.test.tsx') &&
        !name.endsWith('.d.ts')
      ) {
        out.push(relative(ROOT, abs))
      }
    }
  }
  walk(join(ROOT, 'src'))
  return out.sort()
}

/**
 * A hand-built path to TerMinal's own config dir.
 *
 * Requires `homedir()` ADJACENT to the path parts, which is what makes this a
 * construction rather than prose. The tree is full of legitimate mentions of
 * `~/.config/TerMinal` in comments and in agent prompt strings ("the CLI is on
 * PATH via ~/.config/TerMinal/bin"), and flagging those would train everyone to
 * ignore this test.
 *
 * Deliberately does NOT match `homedir()` on its own — roughly twenty
 * legitimate uses reach for `~/.claude`, `~/.codex`, `~/.bun` and `~/.hermes`,
 * which are other tools' state and out of scope.
 */
const HANDBUILT =
  /homedir\(\)\s*,\s*['"]\.config['"]\s*,\s*['"]TerMinal['"]|\$\{homedir\(\)\}\/\.config\/TerMinal/

/** Comment lines describe the path; they do not build it. */
const isComment = (line: string): boolean => /^\s*(?:\/\/|\*|\/\*)/.test(line)

describe('every path to TerMinal state goes through the seam (ticket 108)', () => {
  test('no source outside config-dir.ts builds the path by hand', () => {
    const offenders: string[] = []
    for (const rel of sources()) {
      if (rel === SEAM) continue
      const src = readFileSync(join(ROOT, rel), 'utf8')
      src.split('\n').forEach((line, i) => {
        if (!isComment(line) && HANDBUILT.test(line))
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`)
      })
    }
    expect(offenders).toEqual([])
  })

  test('the scan actually looks at the tree — a guard matching nothing is not a guard', () => {
    const all = sources()
    expect(all.length).toBeGreaterThan(100)
    expect(all).toContain('src/main/agents.ts')
    expect(all).toContain(SEAM)
  })

  test('the pattern still catches the form it was written for', () => {
    // Guards against someone "simplifying" HANDBUILT into something inert.
    expect(HANDBUILT.test(`join(homedir(), '.config', 'TerMinal', 'agents')`)).toBe(true)
    expect(HANDBUILT.test(`join(homedir(), ".config", "TerMinal")`)).toBe(true)
    expect(HANDBUILT.test('`${homedir()}/.config/TerMinal/x`')).toBe(true)
    // And that it leaves OTHER tools' state alone.
    expect(HANDBUILT.test(`join(homedir(), '.claude', 'bin')`)).toBe(false)
    expect(HANDBUILT.test(`join(homedir(), '.codex')`)).toBe(false)
    // ...and PROSE alone, which is everywhere and is not a construction.
    expect(HANDBUILT.test('the CLI lives at ~/.config/TerMinal/bin/terminal-cli')).toBe(false)
    expect(isComment('  // ~/.config/TerMinal/agents/global.json is the registry')).toBe(true)
  })
})

describe('the standalone bin/ processes honour the seam too (ticket 108)', () => {
  // These are SEPARATE PROCESSES writing the same files as the app. A sandboxed
  // run that redirected only the app would still have `terminal-cron` clobbering
  // real state — and a bin script is precisely how an agent would do it.
  const BIN = join(ROOT, 'bin')
  const scripts = readdirSync(BIN).filter((n) => n.startsWith('terminal-') || n === 'gt-notify')

  test('the scan finds the scripts', () => {
    expect(scripts).toContain('terminal-cron')
    expect(scripts).toContain('terminal-cli')
    expect(scripts).toContain('terminal-mcp-server')
    expect(scripts).toContain('terminal-monitor')
  })

  for (const name of scripts) {
    const src = readFileSync(join(BIN, name), 'utf8')
    if (!/\.config['"]?\s*,\s*['"]TerMinal/.test(src) && !src.includes('.config/TerMinal')) continue
    test(`bin/${name} reads TERMINAL_CONFIG_DIR`, () => {
      expect(src).toContain('TERMINAL_CONFIG_DIR')
    })
    test(`bin/${name} has no config path that bypasses it`, () => {
      const offenders: string[] = []
      src.split('\n').forEach((line, i) => {
        if (isComment(line)) return
        if (!/['"]\.config['"]\s*,\s*['"]TerMinal['"]/.test(line)) return
        // The one legal occurrence is the fallback inside the seam itself.
        if (line.includes('TERMINAL_CONFIG_DIR')) return
        offenders.push(`bin/${name}:${i + 1}  ${line.trim().slice(0, 100)}`)
      })
      expect(offenders).toEqual([])
    })
  }
})

describe('the seam resolves per call, not at import (ticket 108)', () => {
  const seam = readFileSync(join(ROOT, SEAM), 'utf8')

  test('it reads the override inside the function body', () => {
    // The original incident was three modules resolving `homedir()` into a
    // module-level const, so a test importing the module was wired to the real
    // directory before its first line ran. If the seam itself ever caches, the
    // whole exercise is undone.
    const body = seam.slice(seam.indexOf('export function terminalConfigDir'))
    expect(body).toContain('process.env.TERMINAL_CONFIG_DIR')
    // No module-level const capturing the resolved value.
    expect(seam).not.toMatch(/^const\s+\w+\s*=\s*(?:join\(homedir|terminalConfigDir\()/m)
  })

  test('configPath is a function, so a caller cannot capture it early', () => {
    expect(seam).toContain('export function configPath(')
  })
})

describe('module-level state paths are lazy (ticket 108)', () => {
  // The sharpest edge the ticket names: a value that LOOKS parameterised and
  // behaves hard-coded. `const FILE = configPath('x')` at module scope is
  // exactly as broken as the homedir() version it replaced — it resolves at
  // import, so the preload's env var is read once, for the first test file, and
  // every later one silently shares it.
  test('no module-scope const resolves a config path at import time', () => {
    const offenders: string[] = []
    for (const rel of sources()) {
      if (rel === SEAM) continue
      const lines = readFileSync(join(ROOT, rel), 'utf8').split('\n')

      // Two passes, because the second-order case is the one that actually bit:
      // `const CFG = terminalConfigDir()` gets fixed, and `const CACHE_DIR =
      // join(CFG(), 'statusline')` right below it is still eager. It looks
      // lazy — it calls a function — but it resolves once, at import.
      // Every name that resolves config state when CALLED — including the lazy
      // arrow accessors, because `const F = CFG()` at module scope is eager
      // even though CFG itself is lazy. That gap is how the monitors.ts
      // default-arg bypasses survived the first pass of this guard.
      const accessors = new Set(['configPath', 'terminalConfigDir'])
      for (let pass = 0; pass < 3; pass++) {
        lines.forEach((line) => {
          const m = /^(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(.+)$/.exec(line)
          if (!m) return
          if ([...accessors].some((fn) => m[2].includes(`${fn}(`))) accessors.add(m[1])
        })
      }
      const eager = accessors

      lines.forEach((line, i) => {
        const m = /^(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(.+)$/.exec(line)
        if (!m) return
        // An arrow that CLOSES OVER an accessor is exactly what we want; one
        // that has already invoked it by the time the module finishes loading
        // is not. The distinction is whether the call sits before the `=>`.
        const beforeArrow = m[2].includes('=>') ? m[2].slice(0, m[2].indexOf('=>')) : m[2]
        if ([...eager].some((fn) => beforeArrow.includes(`${fn}(`))) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
