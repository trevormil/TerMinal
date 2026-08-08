import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Preload → renderer reachability guard.
//
// `src/main/ipc/registrars.test.ts` pins main↔preload symmetry: every channel the
// preload invokes is handled somewhere in main. That is only half the contract.
// It says nothing about whether the RENDERER ever calls the preload key — so a
// key whose UI was never built, or whose UI was later deleted, keeps its handler,
// its preload entry and its type mirror forever and every check stays green.
//
// That blind spot is not hypothetical: it is how an entire dead note-folders
// feature (three handlers, a settings field, and a silent widening of the
// "open in editor" path allowlist) survived two audits. This test closes it.
//
// Failure means one of two things, and both are actionable:
//   - the surface is dead        → delete all three legs (main, preload, types)
//   - the UI has not landed yet  → add it to ALLOWED below, with a reason

const SRC = join(import.meta.dir)
const PRELOAD = join(SRC, 'preload', 'index.ts')
const RENDERER = join(SRC, 'renderer', 'src')

/**
 * Keys with no renderer call site ON PURPOSE. Every entry needs a reason; an
 * entry that outlives its reason is itself dead code, so keep this short.
 */
const ALLOWED = new Set([
  // Autonomous-loop cockpit UI is landing in a parallel branch; `loops.create`
  // is already wired, the rest of the lifecycle controls come with it.
  'loops.step',
  'loops.restart',
  'loops.list',
  'loops.get',
  'loops.state',
  'loops.stop',
  // Settings → Remote hosts "Provision" button is landing in a parallel branch.
  'provisionHost',
  // FOUND BY THIS GUARD, not yet swept. These have no renderer call site either,
  // but they were outside the audited scope of the sweep that added this test, so
  // deleting them here would ship an unreviewed removal. They are a follow-up
  // ticket, not an exemption — burn this block down, do not grow it.
  //   `bg.cancel` is wired but the rest of the background-task surface is not.
  'bg.list',
  'bg.get',
  'bg.log',
  'bg.spawn',
  //   Checkpoints are created by the agent-turn hook in main, never from the UI.
  'checkpoints.create',
  //   The Runs tab reads listener status; nothing toggles the listener from the UI.
  'listeners.toggle',
  //   Tickets are filed through `tickets.spawn` and bin/terminal-cli, not this.
  'tickets.create',
])

/** Comments and string bodies carry unbalanced braces/parens — drop them first. */
function decommented(line: string): string {
  const noComment = line.replace(/\/\/.*$/, '')
  return noComment.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/**
 * The leaf key paths of the `const gt = { … }` literal, e.g. `settings.get`,
 * `notes.read`, `pickDir`.
 *
 * Depth-tracked rather than indentation-matched: a namespace is a line that is
 * exactly `name: {`, and only lines sitting directly inside the current
 * namespace count, which keeps inline parameter types (`cheapLlm: (opts: {
 * messages: … })`) and multi-line signatures from reading as keys.
 */
function preloadKeyPaths(source: string): string[] {
  const paths: string[] = []
  const stack: { name: string; depth: number }[] = []
  let depth = 0
  let started = false

  for (const raw of source.split('\n')) {
    const line = decommented(raw)
    if (!started) {
      if (/\bconst gt = \{/.test(line)) {
        started = true
        depth = 1
      }
      continue
    }

    if (depth === 1 + stack.length) {
      const ns = line.match(/^\s*(\w+): \{$/)
      if (ns) {
        stack.push({ name: ns[1], depth })
        depth += 1
        continue
      }
      const leaf = line.match(/^\s*(\w+):/)
      if (leaf) paths.push([...stack.map((s) => s.name), leaf[1]].join('.'))
    }

    const opens = (line.match(/[{(]/g) || []).length
    const closes = (line.match(/[})]/g) || []).length
    depth += opens - closes
    while (stack.length && depth <= stack[stack.length - 1].depth) stack.pop()
    if (depth <= 0) break
  }
  return paths
}

/** Every renderer source file EXCEPT the type mirror, which restates the surface. */
function rendererSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) rendererSources(p, out)
    else if (/\.(ts|tsx)$/.test(name) && p !== join(RENDERER, 'lib', 'types.ts')) out.push(p)
  }
  return out
}

const KEYS = preloadKeyPaths(readFileSync(PRELOAD, 'utf8'))
// Prettier breaks long call chains across lines (`window.gt.repoTrust\n  .status()`),
// so the dotted path only exists once the newline+indent before each `.` is gone.
const CORPUS = rendererSources(RENDERER)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')
  .replace(/\s+\./g, '.')

describe('preload → renderer reachability', () => {
  test('the parser actually found the gt surface', () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously true — the exact failure mode this whole file exists to catch.
    expect(KEYS.length).toBeGreaterThan(150)
    expect(KEYS).toContain('settings.get')
    expect(KEYS).toContain('notes.read')
    expect(KEYS).toContain('persistentAgents.files.list')
    expect(KEYS).toContain('pickDir')
  })

  test('every preload key has a renderer call site', () => {
    const unreferenced = KEYS.filter((k) => !ALLOWED.has(k) && !CORPUS.includes(`.${k}`)).sort()
    expect(unreferenced).toEqual([])
  })

  test('no allowlist entry is stale — a wired key must not stay excused', () => {
    const wired = [...ALLOWED].filter((k) => CORPUS.includes(`.${k}`)).sort()
    expect(wired).toEqual([])
  })

  test('no allowlist entry names a key the preload no longer exposes', () => {
    const gone = [...ALLOWED].filter((k) => !KEYS.includes(k)).sort()
    expect(gone).toEqual([])
  })
})
