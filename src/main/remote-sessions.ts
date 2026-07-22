import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Remote sessions — the phone's whole model.
//
// A session OPTS IN by running the `remote-terminal` skill, which registers it
// here. Nothing is scraped: the agent itself posts what it wants you to see and
// reads what you send back, so this works identically for claude, codex, or
// anything else that can run a shell command. No pty, no transcript parsing.
//
// Layout, one directory per install:
//   ~/.config/TerMinal/remote/<id>.json    metadata + delivery cursor
//   ~/.config/TerMinal/remote/<id>.jsonl   append-only message log

export const REMOTE_DIR = join(homedir(), '.config', 'TerMinal', 'remote')

export type RemoteStatus =
  /** Agent is working; nothing is expected from you. */
  | 'working'
  /** Agent is blocked in `ask` and waiting on your reply. */
  | 'awaiting'
  /** Session finished or was ended. */
  | 'ended'

export type RemoteSession = {
  id: string
  title: string
  repo: string
  branch: string
  cwd: string
  engine: string
  status: RemoteStatus
  registeredAt: number
  lastSeenAt: number
  /** What the agent is waiting on, when status is 'awaiting'. */
  question?: string
  /**
   * How many messages the agent has consumed. Replies you send while it is
   * busy queue up behind this and are handed over at its next check, rather
   * than being lost.
   */
  deliveredUpTo: number
}

export type RemoteMessage = {
  at: number
  from: 'agent' | 'user'
  text: string
}

const metaPath = (id: string, dir: string) => join(dir, `${id}.json`)
const logPath = (id: string, dir: string) => join(dir, `${id}.jsonl`)

/** Reject anything that could escape the remote directory. */
export function isValidRemoteId(id: unknown): id is string {
  return typeof id === 'string' && /^[\w-]{1,64}$/.test(id)
}

function ensure(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
}

export function readRemoteSession(id: string, dir: string = REMOTE_DIR): RemoteSession | null {
  if (!isValidRemoteId(id)) return null
  try {
    return JSON.parse(readFileSync(metaPath(id, dir), 'utf8')) as RemoteSession
  } catch {
    return null
  }
}

function writeMeta(session: RemoteSession, dir: string): void {
  ensure(dir)
  writeFileSync(metaPath(session.id, dir), JSON.stringify(session, null, 2), { mode: 0o600 })
}

export function registerRemoteSession(
  input: {
    title?: string
    repo?: string
    branch?: string
    cwd?: string
    engine?: string
    id?: string
  },
  dir: string = REMOTE_DIR,
): RemoteSession {
  const id = isValidRemoteId(input.id) ? input.id : randomUUID().slice(0, 8)
  const now = Date.now()
  const existing = readRemoteSession(id, dir)
  const session: RemoteSession = {
    id,
    title: input.title || existing?.title || 'session',
    repo: input.repo || existing?.repo || '',
    branch: input.branch || existing?.branch || '',
    cwd: input.cwd || existing?.cwd || '',
    engine: input.engine || existing?.engine || '',
    // Re-registering an existing session resumes it rather than wiping its log.
    status: 'working',
    registeredAt: existing?.registeredAt || now,
    lastSeenAt: now,
    deliveredUpTo: existing?.deliveredUpTo ?? 0,
  }
  writeMeta(session, dir)
  return session
}

export function listRemoteSessions(dir: string = REMOTE_DIR): RemoteSession[] {
  if (!existsSync(dir)) return []
  const out: RemoteSession[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const session = readRemoteSession(file.slice(0, -'.json'.length), dir)
    if (session) out.push(session)
  }
  // Anything waiting on you first, then most recently active.
  return out.sort((a, b) => {
    const wait = Number(b.status === 'awaiting') - Number(a.status === 'awaiting')
    return wait !== 0 ? wait : b.lastSeenAt - a.lastSeenAt
  })
}

export function readMessages(
  id: string,
  opts: { after?: number } = {},
  dir: string = REMOTE_DIR,
): RemoteMessage[] {
  if (!isValidRemoteId(id)) return []
  let raw = ''
  try {
    raw = readFileSync(logPath(id, dir), 'utf8')
  } catch {
    return []
  }
  const out: RemoteMessage[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as RemoteMessage)
    } catch {
      // The log is appended to live; a torn final line is normal.
    }
  }
  return out.slice(Math.max(0, opts.after ?? 0))
}

export function messageCount(id: string, dir: string = REMOTE_DIR): number {
  return readMessages(id, {}, dir).length
}

function touch(id: string, patch: Partial<RemoteSession>, dir: string): RemoteSession | null {
  const session = readRemoteSession(id, dir)
  if (!session) return null
  const next = { ...session, ...patch, lastSeenAt: Date.now() }
  writeMeta(next, dir)
  return next
}

/** Append a message. Returns the session, or null when it isn't registered. */
export function postMessage(
  id: string,
  from: RemoteMessage['from'],
  text: string,
  dir: string = REMOTE_DIR,
): RemoteSession | null {
  if (!isValidRemoteId(id) || !text.trim()) return null
  const session = readRemoteSession(id, dir)
  if (!session) return null
  ensure(dir)
  appendFileSync(
    logPath(id, dir),
    JSON.stringify({ at: Date.now(), from, text } satisfies RemoteMessage) + '\n',
    { mode: 0o600 },
  )
  return touch(id, {}, dir)
}

/** Mark the session blocked on a question. */
export function askQuestion(
  id: string,
  question: string,
  dir: string = REMOTE_DIR,
): RemoteSession | null {
  if (!postMessage(id, 'agent', question, dir)) return null
  return touch(id, { status: 'awaiting', question }, dir)
}

/**
 * Hand the agent every reply it hasn't seen and advance the cursor.
 *
 * This is what makes a reply sent mid-work survive: it sits in the log until
 * the agent next checks, rather than needing the agent to be blocked at the
 * moment you hit send.
 */
export function takeReplies(id: string, dir: string = REMOTE_DIR): string[] {
  const session = readRemoteSession(id, dir)
  if (!session) return []
  const all = readMessages(id, {}, dir)
  const fresh = all.slice(session.deliveredUpTo).filter((m) => m.from === 'user')
  if (!fresh.length) return []
  touch(id, { deliveredUpTo: all.length, status: 'working', question: undefined }, dir)
  return fresh.map((m) => m.text)
}

export function endRemoteSession(id: string, dir: string = REMOTE_DIR): RemoteSession | null {
  return touch(id, { status: 'ended' }, dir)
}

/**
 * The session a bare CLI call refers to when `--id` is omitted: the most
 * recently active one that hasn't ended. Convenient for the common case of a
 * single registered session; with several running, the skill passes `--id`.
 */
export function currentRemoteSession(dir: string = REMOTE_DIR): RemoteSession | null {
  return listRemoteSessions(dir).filter((s) => s.status !== 'ended')[0] || null
}
