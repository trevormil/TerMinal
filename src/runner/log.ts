// The runner's two append-only sinks: its own cron.log line and the shared
// activity feed the app tails. Both are best-effort by design — a run must
// never fail because a log write did.
import { appendFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { ActivityEvent } from '../shared/types/activity'
import { ACTIVITY_FILE, CFG, CRON_LOG } from './config'

export function log(msg: string): void {
  try {
    appendFileSync(CRON_LOG(), `${new Date().toISOString()} ${msg}\n`)
  } catch {}
}

export type ActivityInput = Omit<ActivityEvent, 'id' | 'ts'>

export function activity(ev: ActivityInput): void {
  try {
    mkdirSync(CFG(), { recursive: true })
    appendFileSync(
      ACTIVITY_FILE(),
      JSON.stringify({ id: randomUUID(), ts: Date.now(), ...ev }) + '\n',
    )
  } catch {}
}
