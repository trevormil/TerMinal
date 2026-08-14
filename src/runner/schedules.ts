// schedules.json access for the runner. Reads are tolerant (a torn file means
// "no schedules", never a crash); the single write is a FIELD-LEVEL patch under
// the shared lock.
import type { Schedule } from '../shared/types/schedules'
import { readJson, SCHED_FILE } from './config'
import { log } from './log'
import { updateJsonListShared } from './state-io'

export function readSchedules(): Schedule[] {
  const a = readJson<unknown>(SCHED_FILE())
  return Array.isArray(a) ? (a as Schedule[]) : []
}

// `writeSchedules` used to live here: a whole-list overwrite, dead since the
// field-level patch below replaced it. Removed rather than baselined — a
// last-write-wins helper sitting unused next to a read-modify-write one is a
// trap for the next caller, who would reinstate exactly the lost-update bug
// the patch function exists to prevent. Found by ticket 101 pointing eslint at
// bin/ for the first time.
// Field-level patch under the lock. Writing back a list read before the patch
// is what resurrected `enabled: true` on a schedule the user had just disabled.
export function stamp(id: string, patch: Partial<Schedule>): void {
  try {
    updateJsonListShared<Schedule>(SCHED_FILE(), (list) => {
      const i = list.findIndex((s) => s.id === id)
      if (i < 0) return undefined
      const next = [...list]
      next[i] = { ...next[i], ...patch }
      return next
    })
  } catch (e) {
    log(`failed stamping schedule ${id}: ${e}`)
  }
}
