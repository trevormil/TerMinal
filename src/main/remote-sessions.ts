import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
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
  /** The host agent's own session id (CLAUDE_CODE_SESSION_ID / hook session_id).
   *  The precise routing key: cwd can be shared by two sessions in one repo,
   *  this cannot, so replies never cross sessions. */
  agentSessionId?: string
  /** 'phone' when spawned from the phone (nobody at the Mac) — the ONLY case
   *  the Stop hook may park on. A local /remote-terminal registration is
   *  'local' and must never block the human sitting there. */
  origin?: 'phone' | 'local'
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
  /** Image filenames stored next to the log, under <id>.files/. Lets you send
   *  the agent a screenshot, and the agent read it — without bloating the log
   *  with base64. */
  images?: string[]
}

const metaPath = (id: string, dir: string) => join(dir, `${id}.json`)
const logPath = (id: string, dir: string) => join(dir, `${id}.jsonl`)
const filesDir = (id: string, dir: string) => join(dir, `${id}.files`)

/** Absolute path of an image attached to a session. null if it escapes. */
export function imagePath(id: string, name: string, dir: string = REMOTE_DIR): string | null {
  // The charset allows dots, so ban the two names that traverse instead of name.
  if (!isValidRemoteId(id) || !/^[\w.-]{1,128}$/.test(name) || name === '.' || name === '..') {
    return null
  }
  return join(filesDir(id, dir), name)
}

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
    agentSessionId?: string
    origin?: 'phone' | 'local'
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
    agentSessionId: input.agentSessionId || existing?.agentSessionId,
    origin: input.origin || existing?.origin || 'local',
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

/** Save an image for a session; returns the stored filename, or null. */
export function saveImage(
  id: string,
  data: Buffer,
  ext: string,
  dir: string = REMOTE_DIR,
): string | null {
  if (!isValidRemoteId(id) || !data.length) return null
  const safeExt = /^(png|jpg|jpeg|gif|webp|heic)$/i.test(ext) ? ext.toLowerCase() : 'png'
  const fdir = filesDir(id, dir)
  mkdirSync(fdir, { recursive: true, mode: 0o700 })
  // A short random name avoids collisions without another counter.
  const name = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}.${safeExt}`
  writeFileSync(join(fdir, name), data, { mode: 0o600 })
  return name
}

/**
 * Append a message. Returns the session, or null when it isn't registered.
 * Either text or at least one image must be present.
 */
export function postMessage(
  id: string,
  from: RemoteMessage['from'],
  text: string,
  images: string[] = [],
  dir: string = REMOTE_DIR,
): RemoteSession | null {
  if (!isValidRemoteId(id)) return null
  if (!text.trim() && images.length === 0) return null
  const session = readRemoteSession(id, dir)
  if (!session) return null
  ensure(dir)
  const message: RemoteMessage = { at: Date.now(), from, text }
  if (images.length) message.images = images
  appendFileSync(logPath(id, dir), JSON.stringify(message) + '\n', { mode: 0o600 })
  return touch(id, {}, dir)
}

/** Mark the session blocked on a question. */
export function askQuestion(
  id: string,
  question: string,
  dir: string = REMOTE_DIR,
): RemoteSession | null {
  if (!postMessage(id, 'agent', question, [], dir)) return null
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
  // An attached image is handed over as an absolute path the agent can Read,
  // so "look at this screenshot" actually works.
  return fresh.map((m) => {
    if (!m.images?.length) return m.text
    const paths = m.images
      .map((n) => imagePath(id, n, dir))
      .filter((p): p is string => !!p)
      .map((p) => `[image: ${p}]`)
      .join(' ')
    return m.text ? `${m.text}\n${paths}` : paths
  })
}

export function endRemoteSession(id: string, dir: string = REMOTE_DIR): RemoteSession | null {
  return touch(id, { status: 'ended' }, dir)
}

/**
 * Remove a session entirely — meta, log, and any attached images. Terminating
 * (endRemoteSession) leaves the thread readable; deleting drops it from the
 * phone for good. Returns true if anything was removed. Id-validated so a call
 * can never reach outside the remote directory.
 */
export function deleteRemoteSession(id: string, dir: string = REMOTE_DIR): boolean {
  if (!isValidRemoteId(id)) return false
  let removed = false
  for (const p of [metaPath(id, dir), logPath(id, dir)]) {
    if (existsSync(p)) {
      rmSync(p, { force: true })
      removed = true
    }
  }
  const files = filesDir(id, dir)
  if (existsSync(files)) {
    rmSync(files, { recursive: true, force: true })
    removed = true
  }
  return removed
}

/**
 * The session a bare CLI call refers to when `--id` is omitted: the most
 * recently active one that hasn't ended. Convenient for the common case of a
 * single registered session; with several running, the skill passes `--id`.
 */
/** The session a specific host agent registered, by its own session id. */
export function remoteSessionForAgent(
  agentSessionId: string,
  dir: string = REMOTE_DIR,
): RemoteSession | null {
  if (!agentSessionId) return null
  return listRemoteSessions(dir).find((s) => s.agentSessionId === agentSessionId) || null
}

export function currentRemoteSession(dir: string = REMOTE_DIR): RemoteSession | null {
  return listRemoteSessions(dir).filter((s) => s.status !== 'ended')[0] || null
}
