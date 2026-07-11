import type { BgTask } from './bg-tasks'

export type SweepFinal = { status: BgTask['status']; endedAt?: number; mrUrl?: string }

// Apply the finalized status of dead tasks onto a FRESH read of the task list,
// keyed by id. Only tasks still `running` in the fresh copy are finalized — a
// task that was canceled or already finalized while the sweep awaited the
// summarizer must be left exactly as the writer left it. Pure so it's unit-
// testable without electron/timers.
export function applySweepFinals(
  fresh: BgTask[],
  finals: Map<string, SweepFinal>,
): { tasks: BgTask[]; changed: boolean } {
  let changed = false
  for (const t of fresh) {
    const f = finals.get(t.id)
    if (f && t.status === 'running') {
      t.status = f.status
      if (f.endedAt !== undefined) t.endedAt = f.endedAt
      if (f.mrUrl !== undefined) t.mrUrl = f.mrUrl
      changed = true
    }
  }
  return { tasks: fresh, changed }
}
