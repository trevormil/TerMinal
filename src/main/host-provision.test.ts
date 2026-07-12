import { test, expect, describe } from 'bun:test'
import { buildProvisionScript, buildReadinessProbe, parseReadiness } from './host-provision'

describe('buildProvisionScript', () => {
  const s = buildProvisionScript()
  test('installs bun only when missing (idempotent)', () => {
    expect(s).toContain('command -v bun')
    expect(s).toContain('bun.sh/install')
  })
  test('enables linger so --user timers fire headless', () => {
    expect(s).toContain('loginctl enable-linger')
  })
  test('creates the TerMinal runtime dirs', () => {
    expect(s).toContain('.config/TerMinal/bin')
    expect(s).toContain('.config/TerMinal/cron-runs')
  })
})

describe('buildReadinessProbe', () => {
  const p = buildReadinessProbe(['claude', 'codex'])
  test('emits the core readiness keys', () => {
    expect(p).toContain('BUN=')
    expect(p).toContain('LINGER=')
    expect(p).toContain('RUNNER=')
  })
  test('probes each requested engine', () => {
    expect(p).toContain('ENGINE_claude=')
    expect(p).toContain('ENGINE_codex=')
    expect(p).toContain('command -v claude')
    expect(p).toContain('command -v codex')
  })
})

describe('parseReadiness', () => {
  test('parses a fully-ready host', () => {
    const raw = ['BUN=1.3.14', 'LINGER=yes', 'RUNNER=ok', 'CLI=ok', 'ENGINE_codex=/home/u/.bun/bin/codex', 'ENGINE_claude='].join('\n')
    const r = parseReadiness(raw, ['claude', 'codex'])
    expect(r.bun).toBe('1.3.14')
    expect(r.linger).toBe(true)
    expect(r.runner).toBe(true)
    expect(r.cli).toBe(true)
    expect(r.engines).toEqual({ claude: false, codex: true })
    expect(r.ready).toBe(true) // bun + linger + runner present; engines are informational
  })
  test('not ready when bun missing', () => {
    const r = parseReadiness(['BUN=', 'LINGER=yes', 'RUNNER=ok'].join('\n'), [])
    expect(r.bun).toBeNull()
    expect(r.ready).toBe(false)
  })
  test('not ready when linger off (would not fire headless)', () => {
    const r = parseReadiness(['BUN=1.3.14', 'LINGER=no', 'RUNNER=ok'].join('\n'), [])
    expect(r.linger).toBe(false)
    expect(r.ready).toBe(false)
  })
  test('not ready when runner not installed', () => {
    const r = parseReadiness(['BUN=1.3.14', 'LINGER=yes', 'RUNNER=missing'].join('\n'), [])
    expect(r.runner).toBe(false)
    expect(r.ready).toBe(false)
  })
  test('collects missing reasons for the UI', () => {
    const r = parseReadiness(['BUN=', 'LINGER=no', 'RUNNER=ok'].join('\n'), [])
    expect(r.missing).toContain('bun')
    expect(r.missing).toContain('linger')
    expect(r.missing).not.toContain('runner')
  })
})
