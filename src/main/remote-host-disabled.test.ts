import { describe, expect, test, beforeEach, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REMOTE_SCRIPT } from './remote'

// The host's circuit-breaker file lives on the HOST, so reading it is a new op in
// the shipped helper script. Run the script the way SSH does (`node -e <script>`)
// against a temp HOME, so this covers the real shipped path — a reimplementation
// here would prove nothing about what actually runs on the box.

let base: string
let home: string
const disabledFile = () => join(home, '.config', 'TerMinal', 'agents', 'disabled.json')

function run(input: Record<string, unknown>): unknown {
  const stdout = execFileSync('node', ['-e', REMOTE_SCRIPT, JSON.stringify(input)], {
    cwd: home,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
  return JSON.parse(stdout)
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'tm-host-disabled-')))
  home = join(base, 'home')
  mkdirSync(join(home, '.config', 'TerMinal', 'agents'), { recursive: true })
})
afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true })
})

describe('remote host script · schedules.disabled', () => {
  test('returns the breaker state the host runner wrote, reasons included', () => {
    writeFileSync(
      disabledFile(),
      JSON.stringify({
        scheduleIds: ['sched-1'],
        reasons: { 'sched-1': { reason: 'auto-disabled after 3 consecutive failures', at: 1234 } },
      }),
    )
    expect(run({ op: 'schedules.disabled' })).toEqual({
      scheduleIds: ['sched-1'],
      reasons: { 'sched-1': { reason: 'auto-disabled after 3 consecutive failures', at: 1234 } },
    })
  })

  test('a host with no breaker file reads as empty, not an error', () => {
    expect(run({ op: 'schedules.disabled' })).toEqual({ scheduleIds: [], reasons: {} })
  })

  test('a legacy bare-array file is normalized', () => {
    writeFileSync(disabledFile(), JSON.stringify(['old']))
    expect(run({ op: 'schedules.disabled' })).toEqual({ scheduleIds: ['old'], reasons: {} })
  })
})

describe('remote host script · schedules.setDisabled', () => {
  test('re-enabling drops the id AND its reason from the host file', () => {
    writeFileSync(
      disabledFile(),
      JSON.stringify({ scheduleIds: ['a', 'b'], reasons: { a: { reason: 'boom', at: 1 } } }),
    )
    expect(run({ op: 'schedules.setDisabled', id: 'a', disabled: false })).toBe(true)
    const after = JSON.parse(readFileSync(disabledFile(), 'utf8'))
    expect(after.scheduleIds).toEqual(['b'])
    expect(after.reasons).toEqual({})
  })

  test('disabling adds the id with a reason the UI can show', () => {
    expect(
      run({ op: 'schedules.setDisabled', id: 'a', disabled: true, reason: 'paused from Mac' }),
    ).toBe(true)
    const after = JSON.parse(readFileSync(disabledFile(), 'utf8'))
    expect(after.scheduleIds).toEqual(['a'])
    expect(after.reasons.a.reason).toBe('paused from Mac')
    expect(after.reasons.a.at).toBeGreaterThan(0)
  })

  test('the file the runner reads keeps its scheduleIds key — the runner parses that', () => {
    run({ op: 'schedules.setDisabled', id: 'a', disabled: true })
    expect(Object.keys(JSON.parse(readFileSync(disabledFile(), 'utf8')))).toContain('scheduleIds')
  })

  test('re-enabling something already enabled is idempotent, not a failure', () => {
    expect(run({ op: 'schedules.setDisabled', id: 'ghost', disabled: false })).toBe(true)
    expect(JSON.parse(readFileSync(disabledFile(), 'utf8')).scheduleIds).toEqual([])
  })
})
