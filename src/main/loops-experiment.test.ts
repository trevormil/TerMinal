import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { experimentGate } from '../shared/experiments'

// Loops ship behind the `loops` experiment flag. Hiding the EntryScreen
// affordance is NOT a gate — `gt.loops.create` is reachable from the renderer
// (and from anything else holding the preload bridge), so the refusal has to
// live in main. These tests pin both halves: the gate function's behavior, and
// the fact that the create handler and the UI actually call the gate.

const ROOT = resolve(import.meta.dir, '../..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

describe('experimentGate — the server-side gate for loops:create', () => {
  test('refuses with an actionable error when the flag is off', () => {
    const r = experimentGate({ experiments: { loops: false } }, 'loops')
    expect(r).not.toBeNull()
    expect(r!.error).toContain('experimental')
    // The message has to name where to turn it on, or the refusal is a dead end.
    expect(r!.error).toContain('Settings')
  })

  test('refuses when experiments are absent entirely (fails closed)', () => {
    // A settings file written before the flag existed must not read as "on".
    expect(experimentGate({}, 'loops')).not.toBeNull()
    expect(experimentGate(null, 'loops')).not.toBeNull()
    expect(experimentGate(undefined, 'loops')).not.toBeNull()
    expect(experimentGate({ experiments: {} }, 'loops')).not.toBeNull()
  })

  test('refuses when a DIFFERENT experiment is on', () => {
    expect(experimentGate({ experiments: { lanes: true } }, 'loops')).not.toBeNull()
  })

  test('passes only on an explicit true', () => {
    expect(experimentGate({ experiments: { loops: true } }, 'loops')).toBeNull()
  })
})

describe('the gate is wired where it matters', () => {
  test('the loops:create handler calls it before creating anything', () => {
    const src = read('src/main/index.ts')
    const start = src.indexOf("ipcMain.handle('loops:create'")
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf("ipcMain.handle('loops:step'", start))
    expect(body).toContain("experimentGate(readSettings(), 'loops')")
    // …and it must return the refusal, not merely compute it.
    expect(body).toMatch(/experimentGate\(readSettings\(\), 'loops'\)\n\s*if \(\w+\) return \w+/)
    // Ordering: the gate has to precede createLoop, which cuts a git worktree.
    expect(body.indexOf('experimentGate')).toBeLessThan(body.indexOf('createLoop('))
  })

  test('the EntryScreen loop affordance is behind useExperiment', () => {
    const src = read('src/renderer/src/components/EntryScreen.tsx')
    expect(src).toContain("useExperiment('loops')")
    // The mode toggle must not offer 'loop' when the flag is off.
    expect(src).toContain("loopsOn ? (['single', 'loop'] as const) : (['single'] as const)")
  })

  test('the renderer consumes stop and state — every startable loop is stoppable', () => {
    const src = read('src/renderer/src/SessionView.tsx')
    // Prettier may break the member chain across lines — match past whitespace.
    expect(src).toMatch(/window\.gt\s*\.?\s*loops\s*\.?\s*stop\(/)
    expect(src).toMatch(/window\.gt\s*\.?\s*loops\s*\.?\s*state\(/)
    // The stop control must be a real affordance, not just a call site.
    expect(src).toContain('aria-label="Stop loop"')
  })
})

describe('EXPERIMENT_META.loops.reveals describes what the flag actually reveals', () => {
  test('it names the paired-loop entry mode and the session controls', () => {
    const meta = read('src/shared/experiments.ts')
    const reveals = meta
      .slice(meta.indexOf('loops: {'), meta.indexOf('lanes: {'))
      .slice(meta.slice(meta.indexOf('loops: {')).indexOf('reveals:'))
      .toLowerCase()
    // The three things the flag actually turns on, and nothing more.
    expect(reveals).toContain('paired loop')
    expect(reveals).toContain('status strip')
    expect(reveals).toContain('stop loop')
    // It must not promise a cockpit tab — there isn't one.
    expect(reveals).not.toContain('cockpit')
    expect(reveals).not.toContain(' tab')
  })
})
