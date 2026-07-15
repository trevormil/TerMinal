import type { ActivityKind } from './events'

// Cycle-time linkage: join a ticket's lifecycle events via the ref join keys
// (ticket-filed{ticket} → pr-opened{ticket,pr} → pr-merged{pr}) to measure how
// long work takes to flow through the factory and where it stalls. Pure — no
// electron / disk imports — so it is unit-testable.

const HOUR = 3_600_000
const DAY = 86_400_000

export type CycleStats = {
  merged: number // tickets with a full filed→merged chain (last 30d)
  medianHours: number | null // median ticket-filed → pr-merged
  fileToOpenHours: number | null // median filed → pr-opened
  openToMergeHours: number | null // median pr-opened → pr-merged
}
export type Funnel = { filed: number; opened: number; merged: number } // distinct tickets, last 7d cohort

export type CycleEvent = { kind: ActivityKind; ts: number; ref?: { ticket?: number; pr?: number } }

const median = (arr: number[]): number | null =>
  arr.length ? [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)] : null
const toH = (ms: number | null): number | null =>
  ms == null ? null : Math.round((ms / HOUR) * 10) / 10

export function cycleAndFunnel(
  events: CycleEvent[],
  now: number,
): { cycle: CycleStats; funnel: Funnel } {
  const filedAt = new Map<number, number>() // ticket → earliest filed
  const openedAt = new Map<number, number>() // ticket → earliest pr-opened
  const ticketPr = new Map<number, number>() // ticket → pr (the bridge)
  const mergedAt = new Map<number, number>() // pr → earliest merged
  const min = (m: Map<number, number>, k: number, v: number) =>
    m.set(k, Math.min(m.get(k) ?? Infinity, v))
  for (const e of events) {
    const t = e.ref?.ticket
    const p = e.ref?.pr
    if (e.kind === 'ticket-filed' && t != null) min(filedAt, t, e.ts)
    if (e.kind === 'pr-opened' && t != null) {
      min(openedAt, t, e.ts)
      if (p != null) ticketPr.set(t, p)
    }
    if (e.kind === 'pr-merged' && p != null) min(mergedAt, p, e.ts)
  }
  const cycles: number[] = []
  const f2o: number[] = []
  const o2m: number[] = []
  for (const [ticket, filed] of filedAt) {
    const pr = ticketPr.get(ticket)
    const opened = openedAt.get(ticket)
    const merged = pr != null ? mergedAt.get(pr) : undefined
    if (merged != null && merged >= now - 30 * DAY) {
      cycles.push(merged - filed)
      if (opened != null) {
        f2o.push(opened - filed)
        o2m.push(merged - opened)
      }
    }
  }
  // 7d funnel cohort: tickets filed in the window, how far each got
  const since = now - 7 * DAY
  const filed7 = new Set<number>()
  for (const e of events)
    if (e.kind === 'ticket-filed' && e.ref?.ticket != null && e.ts >= since)
      filed7.add(e.ref.ticket)
  let opened7 = 0
  let merged7 = 0
  for (const t of filed7) {
    if (openedAt.has(t)) opened7++
    const pr = ticketPr.get(t)
    if (pr != null && mergedAt.has(pr)) merged7++
  }
  return {
    cycle: {
      merged: cycles.length,
      medianHours: toH(median(cycles)),
      fileToOpenHours: toH(median(f2o)),
      openToMergeHours: toH(median(o2m)),
    },
    funnel: { filed: filed7.size, opened: opened7, merged: merged7 },
  }
}
