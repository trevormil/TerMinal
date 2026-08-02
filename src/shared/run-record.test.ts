import { describe, expect, test } from 'bun:test'
import {
  RUN_STATUSES,
  finalizeStaleRun,
  isRunStatus,
  isSettledRunStatus,
  normalizeRunStatus,
  type RunStatus,
} from './run-record'
import type { AgentRunStatus } from '../main/agent-types'
import type { BgTaskStatus } from '../main/bg-tasks'

// Ticket 91: one run-status vocabulary. The four stores used to declare their
// own unions that disagreed by omission — which is exactly what let
// UnifiedRun.status widen to `string`.

describe('the vocabulary anchors every store subset', () => {
  test('AgentRunStatus and BgTaskStatus are subsets of RunStatus', () => {
    // Type-level: these assignments fail to compile if a store invents a
    // status the shared list doesn't know.
    const a: RunStatus = 'done' satisfies AgentRunStatus
    const b: RunStatus = 'queued' satisfies BgTaskStatus
    expect([a, b]).toEqual(['done', 'queued'])
  })

  test('guard accepts exactly the list', () => {
    for (const s of RUN_STATUSES) expect(isRunStatus(s)).toBe(true)
    expect(isRunStatus('ok')).toBe(false)
    expect(isRunStatus('')).toBe(false)
    expect(isRunStatus(undefined)).toBe(false)
  })

  test('unknown remote statuses bucket as failed, never as healthy', () => {
    expect(normalizeRunStatus('running')).toBe('running')
    expect(normalizeRunStatus('exploded')).toBe('failed')
    expect(normalizeRunStatus(null)).toBe('failed')
  })

  test('settled = nothing will update it again', () => {
    expect(isSettledRunStatus('running')).toBe(false)
    expect(isSettledRunStatus('queued')).toBe(false)
    for (const s of ['done', 'failed', 'canceled', 'interrupted'] as const)
      expect(isSettledRunStatus(s)).toBe(true)
  })
})

describe('finalizeStaleRun', () => {
  const NOW = 10_000_000

  test('age-gated policy (cron): young running records are left alone', () => {
    const policy = { finalStatus: 'failed' as const, error: 'stale', olderThanMs: 1000 }
    expect(finalizeStaleRun({ status: 'running', startedAt: NOW - 10 }, policy, NOW)).toBeNull()
    const old = finalizeStaleRun({ status: 'running', startedAt: NOW - 5000 }, policy, NOW)
    expect(old?.status).toBe('failed')
    expect(old?.endedAt).toBe(NOW)
    expect(old?.error).toBe('stale')
  })

  test('unconditional policy (session zombies at startup)', () => {
    const policy = { finalStatus: 'interrupted' as const, error: 'interrupted: app restarted' }
    const z = finalizeStaleRun({ status: 'running', startedAt: NOW - 1 }, policy, NOW)
    expect(z?.status).toBe('interrupted')
  })

  test('settled records are never touched, and existing endedAt/error win', () => {
    const policy = { finalStatus: 'failed' as const, error: 'stale' }
    expect(finalizeStaleRun({ status: 'done', startedAt: 0 }, policy, NOW)).toBeNull()
    const kept = finalizeStaleRun(
      { status: 'running', startedAt: 0, endedAt: 42, error: 'real error' },
      policy,
      NOW,
    )
    expect(kept?.endedAt).toBe(42)
    expect(kept?.error).toBe('real error')
  })
})
