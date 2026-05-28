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

// Activity feed + system notifications. Events are stored GLOBALLY (one log
// across every repo/session) but each is tagged with repo + session, so the
// Activity tab can show the global firehose or filter to one repo/session.
const LOG = join(homedir(), '.config', 'gauntlet-terminal', 'activity.jsonl')
const MAX_KEEP = 2000 // cap the on-disk log

export type ActivityKind =
  | 'task-complete'
  | 'ticket-filed'
  | 'pr-verdict'
  | 'session-start'
  | 'agent-run'
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
}

// which kinds raise a macOS notification (vs. log-only). task/ticket/pr matter;
// session-start is just feed context.
const NOTIFY: Record<ActivityKind, boolean> = {
  'task-complete': true,
  'ticket-filed': true,
  'pr-verdict': true,
  'agent-run': true,
  error: true,
  'session-start': false,
  info: false,
}

let broadcast: (ev: ActivityEvent) => void = () => {}
export function onActivity(fn: (ev: ActivityEvent) => void) {
  broadcast = fn
}

export function emitActivity(
  e: Omit<ActivityEvent, 'id' | 'ts'>,
  opts?: { notify?: boolean },
): ActivityEvent {
  const ev: ActivityEvent = { ...e, id: randomUUID(), ts: Date.now() }
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, JSON.stringify(ev) + '\n')
  } catch {
    /* best effort */
  }
  const notify = opts?.notify ?? NOTIFY[ev.kind]
  if (notify && Notification.isSupported()) {
    try {
      new Notification({ title: ev.title, body: ev.detail || '' }).show()
    } catch {
      /* notifications unavailable */
    }
  }
  // NOTE: don't broadcast here — the file tail (below) picks up this append and
  // broadcasts it, so terminal-written and skill-written events flow through one
  // path (no double feed entries). The notification above is the instant signal.
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
        broadcast(JSON.parse(line) as ActivityEvent)
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
