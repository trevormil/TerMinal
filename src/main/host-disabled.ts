// Host-aware circuit-breaker state (ADR-0002).
//
// bin/terminal-cron trips the breaker after N consecutive failures by writing
// the HOST's ~/.config/TerMinal/agents/disabled.json. agents-disabled.ts reads
// only the LOCAL file, so a schedule the host had already given up on still
// rendered enabled/healthy in the Mac UI. This module reads (and writes) the
// host's copy over the SAME SSH plumbing every other remote read uses
// (remote.ts remoteJson → remote-host-script.cjs), with a short TTL cache so a
// re-render never means one SSH per schedule row.

import { remoteMutation, type MutationResult } from './schedule-honesty'
import { remoteSchedules, type RemoteSessionRef } from './remote'

export type HostDisabledEntry = {
  id: string
  host: string
  hostLabel: string
  reason?: string
  disabledAt: number
}
export type HostBreakerSnapshot = {
  entries: HostDisabledEntry[]
  /** Hosts we could not read — never reported as "nothing disabled". */
  errors: { host: string; hostLabel: string; error: string }[]
}

export type HostDisabledDeps = {
  fetch: (ref: RemoteSessionRef) => Promise<unknown>
  setDisabled: (ref: RemoteSessionRef, id: string, disabled: boolean) => Promise<boolean>
  now: () => number
  ttlMs: number
}

const realDeps: HostDisabledDeps = {
  fetch: (ref) => remoteSchedules.disabled(ref),
  setDisabled: (ref, id, disabled) => remoteSchedules.setDisabled(ref, id, disabled),
  now: () => Date.now(),
  ttlMs: 15_000,
}

/** Tolerant parse of the host's disabled.json — same shapes agents-disabled.ts
 *  accepts (object with scheduleIds + reasons side-car, or a legacy bare array). */
export function parseHostDisabled(raw: unknown, ref: RemoteSessionRef): HostDisabledEntry[] {
  const obj = raw as { scheduleIds?: unknown; reasons?: unknown } | null
  const rawIds = Array.isArray(raw) ? raw : Array.isArray(obj?.scheduleIds) ? obj!.scheduleIds : []
  const reasons =
    obj && !Array.isArray(raw) && obj.reasons && typeof obj.reasons === 'object'
      ? (obj.reasons as Record<string, { reason?: unknown; at?: unknown }>)
      : {}
  return (rawIds as unknown[])
    .filter((x): x is string => typeof x === 'string')
    .map((id) => {
      const r = reasons[id]
      const reason = typeof r?.reason === 'string' && r.reason.trim() ? r.reason.trim() : undefined
      return {
        id,
        host: ref.hostId,
        hostLabel: ref.label || ref.hostId,
        reason,
        disabledAt: typeof r?.at === 'number' ? r.at : 0,
      }
    })
}

type CacheRow = { at: number; entries: HostDisabledEntry[]; error?: string }
const cache = new Map<string, CacheRow>()

/** Drop cached breaker state — for one host, or all of them. */
export function invalidateHostBreaker(hostId?: string): void {
  if (hostId) cache.delete(hostId)
  else cache.clear()
}

/** Breaker state for the given hosts, deduped and cached for `ttlMs`. */
export async function hostBreakerState(
  refs: RemoteSessionRef[],
  deps: HostDisabledDeps = realDeps,
): Promise<HostBreakerSnapshot> {
  const byId = new Map<string, RemoteSessionRef>()
  for (const r of refs) if (r?.hostId && !byId.has(r.hostId)) byId.set(r.hostId, r)
  const snap: HostBreakerSnapshot = { entries: [], errors: [] }
  await Promise.all(
    [...byId.values()].map(async (ref) => {
      const hit = cache.get(ref.hostId)
      const row =
        hit && deps.now() - hit.at < deps.ttlMs
          ? hit
          : await deps
              .fetch(ref)
              .then((raw) => ({ at: deps.now(), entries: parseHostDisabled(raw, ref) }) as CacheRow)
              .catch(
                (e) =>
                  ({
                    at: deps.now(),
                    entries: [],
                    error: (e as Error)?.message || String(e),
                  }) as CacheRow,
              )
      cache.set(ref.hostId, row)
      if (row.error)
        snap.errors.push({ host: ref.hostId, hostLabel: ref.label || ref.hostId, error: row.error })
      snap.entries.push(...row.entries)
    }),
  )
  return snap
}

/** Flip the breaker on the HOST's disabled.json (the re-enable affordance). */
export async function setHostDisabled(
  ref: RemoteSessionRef,
  id: string,
  disabled: boolean,
  deps: HostDisabledDeps = realDeps,
): Promise<MutationResult> {
  const r = await remoteMutation(ref.label || ref.hostId, () => deps.setDisabled(ref, id, disabled))
  invalidateHostBreaker(ref.hostId)
  return r
}
