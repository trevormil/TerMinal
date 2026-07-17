import { Notification } from 'electron'
import {
  appendFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  watch,
} from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { readSettings } from './settings'
import { inferActivityKind } from './event-classifier'
import {
  createDesktopChannel,
  createTelegramChannel,
  createWebhookChannel,
  dispatchAlert,
  type NotifyChannel,
} from './notify-channels'

// Activity feed + system notifications. Events are stored GLOBALLY (one log
// across every repo/session) but each is tagged with repo + session, so the
// Activity tab can show the global firehose or filter to one repo/session.
const LOG = join(homedir(), '.config', 'TerMinal', 'activity.jsonl')
const MAX_KEEP = 2000 // cap the on-disk log

// Canonical activity kinds — workflow checkpoints emitted by the app AND by the
// skills (project-template/.claude/bin/activity + bin/gt-notify emit these by
// name). Keep in sync with src/renderer/src/lib/types.ts and the tab's ICON/tone
// maps. Unknown kinds still render (Info icon + mute tone fallbacks).
export type ActivityKind =
  | 'session-start'
  | 'session-end'
  | 'deploy'
  | 'ticket-filed'
  | 'ticket-closed'
  | 'pr-opened'
  | 'pr-verdict'
  | 'pr-merged'
  | 'tests-pass'
  | 'tests-fail'
  | 'check'
  | 'doc'
  | 'agent-run'
  | 'task-complete'
  | 'blocked'
  | 'error'
  | 'info'

export type ActivityEvent = {
  id: string
  ts: number
  kind: ActivityKind
  title: string
  detail?: string
  repo?: string
  repoRoot?: string
  sessionId?: string
  // join keys for cycle-time linkage: connect a ticket's events across its life
  // (ticket-filed → pr-opened{ticket,pr} → pr-verdict{pr} → pr-merged{pr}).
  ref?: { ticket?: number; pr?: number }
  // Pointer back to the originating cron / in-process run, so clicking the
  // event in the Activity tab can jump to that run's log in the Runs tab.
  runId?: string
  runSource?: 'cron' | 'agent' | 'bg' | 'session'
  // Set when the event is a HITL filing — drives the inline Telegram buttons
  // ([Resolve] / [View run]) so the user can act from the chat without
  // having to text /hitl + /resolve.
  hitlId?: string
  // Set by HITL producers that already send a direct Telegram message. The
  // activity event should still hit the in-app feed and desktop notifications,
  // but must not be mirrored to Telegram a second time by the app tail.
  suppressTelegram?: boolean
}

// which kinds raise a macOS/Telegram notification (vs. log-only feed context).
// High-signal checkpoints ping; routine/contextual ones are log-only.
const NOTIFY: Record<ActivityKind, boolean> = {
  'session-start': false,
  'session-end': false,
  deploy: false,
  'ticket-filed': true,
  'ticket-closed': false,
  'pr-opened': false,
  'pr-verdict': true,
  'pr-merged': true,
  'tests-pass': false,
  'tests-fail': true,
  check: false,
  doc: false,
  'agent-run': true,
  'task-complete': true,
  blocked: true,
  error: true,
  info: false,
}

let broadcast: (ev: ActivityEvent) => void = () => {}
export function onActivity(fn: (ev: ActivityEvent) => void) {
  broadcast = fn
}

// The outbound alert channels (notify-channels.ts): Telegram, desktop, webhook.
// Each gates itself on Settings; dispatchAlert isolates per-channel failures.
function showDesktopNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  try {
    new Notification({ title, body }).show()
  } catch {
    /* notifications unavailable */
  }
}
const alertChannels: NotifyChannel[] = [
  createTelegramChannel(readSettings),
  createDesktopChannel(readSettings, showDesktopNotification),
  createWebhookChannel(readSettings),
]

// Fan one event out to every enabled alert channel.
function fireNotification(ev: ActivityEvent): void {
  dispatchAlert(alertChannels, ev)
}

/** Settings "Test" button for the desktop channel. */
export function testDesktopAlert(): { ok: boolean; error?: string } {
  if (!Notification.isSupported())
    return { ok: false, error: 'Desktop notifications are not supported on this system.' }
  try {
    new Notification({ title: 'TerMinal test alert', body: 'Desktop channel is working.' }).show()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// Ids the app emitted in-process (and already notified for) — so the file tail
// doesn't double-notify them. Bounded; old ids age out.
const emittedIds = new Set<string>()
function rememberEmitted(id: string): void {
  emittedIds.add(id)
  if (emittedIds.size > 1000) {
    for (const id of emittedIds) {
      emittedIds.delete(id)
      if (emittedIds.size <= 800) break
    }
  }
}

// Auto-infer kind from title when the caller passed 'info' (or anything
// non-specific) and the title matches a clearer pattern. Saves agents from
// having to specify the right enum every time.
function maybeInferKind(passed: ActivityKind, title: string): ActivityKind {
  // Only run inference when the caller didn't pick a specific kind.
  if (passed !== 'info') return passed
  try {
    return inferActivityKind(title, 'info')
  } catch {
    return passed
  }
}

export function emitActivity(
  e: Omit<ActivityEvent, 'id' | 'ts'>,
  opts?: { notify?: boolean },
): ActivityEvent {
  const inferredKind = maybeInferKind(e.kind, e.title)
  const ev: ActivityEvent = { ...e, kind: inferredKind, id: randomUUID(), ts: Date.now() }
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, JSON.stringify(ev) + '\n')
  } catch {
    /* best effort */
  }
  rememberEmitted(ev.id)
  if (opts?.notify ?? NOTIFY[ev.kind]) fireNotification(ev)
  // NOTE: don't broadcast here — the file tail (below) picks up this append and
  // broadcasts it, so terminal-written and skill-written events flow through one
  // path (no double feed entries). The tail also NOTIFIES external (skill/cron)
  // events — deduped against emittedIds so app emits don't ping twice.
  return ev
}

// Tail the log so events appended by ANYTHING (project-template skills, scripts)
// surface live in the Activity tab — not just events the app emits in-process.
let tailSize = 0
let tailing = false
export function startActivityTail() {
  if (tailing) return
  tailing = true
  try {
    tailSize = existsSync(LOG) ? statSync(LOG).size : 0
  } catch {
    tailSize = 0
  }
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    // watch the dir (the file may be created/rotated) and drain on changes
    watch(dirname(LOG), (_evt, fn) => {
      if (!fn || fn === basename(LOG)) drainTail()
    })
  } catch {
    /* watch unavailable — feed still loads via activity:list */
  }
}

function drainTail() {
  let size = 0
  try {
    size = statSync(LOG).size
  } catch {
    return
  }
  if (size < tailSize) tailSize = 0 // truncated/cleared → restart
  if (size <= tailSize) return
  const len = size - tailSize
  try {
    const fd = openSync(LOG, 'r')
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, tailSize)
    closeSync(fd)
    tailSize = size
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line) as ActivityEvent
        broadcast(ev)
        // Notify for EXTERNAL high-signal events (skills, cron, gt-notify) that the
        // app didn't emit in-process — so skill-raised HITL/blocked/errors actually
        // ping. Deduped against emittedIds so app emits don't double-notify.
        if (!emittedIds.has(ev.id) && NOTIFY[ev.kind]) fireNotification(ev)
      } catch {
        /* partial/garbled line — skip */
      }
    }
  } catch {
    /* read race — next change will catch up */
  }
}

/** Newest-first, capped. */
export function readActivity(limit = 500): ActivityEvent[] {
  if (!existsSync(LOG)) return []
  try {
    const lines = readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
    // opportunistically compact a runaway log
    if (lines.length > MAX_KEEP) {
      try {
        writeFileSync(LOG, lines.slice(-MAX_KEEP).join('\n') + '\n')
      } catch {
        /* ignore */
      }
    }
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as ActivityEvent
        } catch {
          return null
        }
      })
      .filter((e): e is ActivityEvent => !!e)
      .reverse()
  } catch {
    return []
  }
}

export function clearActivity() {
  try {
    if (existsSync(LOG)) writeFileSync(LOG, '')
  } catch {
    /* ignore */
  }
}
