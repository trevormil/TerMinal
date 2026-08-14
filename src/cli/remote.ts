// ---- remote sessions (the phone) -------------------------------------------
// The on-disk half of remote sessions: an agent registers, posts updates, asks
// questions and drains replies through these files, so it keeps working with
// the app closed. Mirrors src/main/remote-sessions.ts.
import { execSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { REMOTE_DIR } from './env'
import type { RemoteMessage, RemoteSession } from './types'

const remoteMeta = (id: string): string => join(REMOTE_DIR(), `${id}.json`)
const remoteLog = (id: string): string => join(REMOTE_DIR(), `${id}.jsonl`)
const validRemoteId = (id: unknown): boolean => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)

function readRemote(id: string): RemoteSession | null {
  if (!validRemoteId(id)) return null
  try {
    return JSON.parse(readFileSync(remoteMeta(id), 'utf8')) as RemoteSession
  } catch {
    return null
  }
}

function writeRemote(session: RemoteSession): void {
  mkdirSync(REMOTE_DIR(), { recursive: true, mode: 0o700 })
  writeFileSync(remoteMeta(session.id), JSON.stringify(session, null, 2), { mode: 0o600 })
}

function remoteMessages(id: string): RemoteMessage[] {
  try {
    return readFileSync(remoteLog(id), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as RemoteMessage
        } catch {
          return null
        }
      })
      .filter(Boolean) as RemoteMessage[]
  } catch {
    return []
  }
}

function remoteAppend(id: string, from: string, text: string, images: string[]): void {
  mkdirSync(REMOTE_DIR(), { recursive: true, mode: 0o700 })
  const msg: RemoteMessage = { at: Date.now(), from, text }
  if (images && images.length) msg.images = images
  appendFileSync(remoteLog(id), JSON.stringify(msg) + '\n', { mode: 0o600 })
}

/** Copy an image file into the session's store, returning the stored name. */
function remoteSaveImage(id: string, srcPath: string): string {
  const ext = (srcPath.split('.').pop() || 'png').toLowerCase()
  const safeExt = /^(png|jpg|jpeg|gif|webp|heic)$/.test(ext) ? ext : 'png'
  const fdir = join(REMOTE_DIR(), `${id}.files`)
  mkdirSync(fdir, { recursive: true, mode: 0o700 })
  const name = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}.${safeExt}`
  writeFileSync(join(fdir, name), readFileSync(srcPath), { mode: 0o600 })
  return name
}

function remoteList(): RemoteSession[] {
  if (!existsSync(REMOTE_DIR())) return []
  return (
    readdirSync(REMOTE_DIR())
      .filter((f) => f.endsWith('.json'))
      .map((f) => readRemote(f.slice(0, -5)))
      .filter(Boolean) as RemoteSession[]
  ).sort((a, b) => b.lastSeenAt - a.lastSeenAt)
}

/**
 * Resolve which session a call refers to.
 *
 * --id wins. Otherwise prefer a session registered from THIS directory: with
 * several sessions registered across repos, "most recent anywhere" would hand
 * one session's replies to another.
 */
function resolveRemoteId(
  flagId: string,
  cwd: string,
  {
    quiet = false,
    soft = false,
    agentSessionId = '',
  }: { quiet?: boolean; soft?: boolean; agentSessionId?: string } = {},
): string {
  // quiet → return '' silently (the Stop hook, on every session).
  // soft  → return '' but let the caller print a graceful notice. Used by
  //         post/ask/end so that deleting a session from the phone, or ending
  //         it, degrades to "no longer remote" instead of crashing the agent's
  //         command with exit 1. Switching desktop⇄remote must never throw.
  if (flagId) {
    if (!readRemote(flagId)) {
      if (quiet || soft) return ''
      console.error(`no registered remote session "${flagId}" — run: terminal-cli remote register`)
      process.exit(1)
    }
    return flagId
  }
  const active = remoteList().filter((s) => s.status !== 'ended')
  // Exact match on the host agent's session id first: two sessions can share a
  // cwd, so cwd alone could deliver a reply to the wrong one. Fall back to cwd,
  // then most-recent, only when no session id is known.
  const sid =
    agentSessionId ||
    process.env.GT_TERMINAL_SESSION_ID ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    process.env.CODEX_SESSION_ID ||
    process.env.TERMINAL_REMOTE_AGENT_SESSION ||
    ''
  const byAgent = sid ? active.find((s) => s.agentSessionId === sid) : null
  const here = cwd ? active.find((s) => s.cwd === cwd) : null
  // `active[0]` is a convenience for a HUMAN typing `terminal-cli remote ...`
  // when there is one obvious session. It must NEVER apply to the automated
  // callers — `quiet` is the Stop hook, which runs on every session on the
  // machine. Otherwise a single stale registration in any repo resolves for
  // every unrelated session and parks each of their turns for the full wait
  // timeout, which reads as the agent hanging.
  const current = byAgent || here || (quiet || soft ? null : active[0])
  if (!current) {
    if (quiet || soft) return ''
    console.error('no registered remote session — run: terminal-cli remote register')
    process.exit(1)
  }
  return current.id
}

function takeRemoteReplies(id: string): string[] {
  const session = readRemote(id)
  if (!session) return []
  const all = remoteMessages(id)
  const fresh = all.slice(session.deliveredUpTo || 0).filter((m) => m.from === 'user')
  if (!fresh.length) return []
  writeRemote({
    ...session,
    deliveredUpTo: all.length,
    status: 'working',
    question: undefined,
    lastSeenAt: Date.now(),
  })
  // Attached images hand over as absolute paths the agent can Read — mirrors
  // src/main/remote-sessions.ts takeReplies, so "look at this screenshot"
  // works through the hook path too.
  return fresh.map((m) => {
    if (!m.images || !m.images.length) return m.text
    const paths = m.images.map((n) => `[image: ${join(REMOTE_DIR(), `${id}.files`, n)}]`).join(' ')
    return m.text ? `${m.text}\n${paths}` : paths
  })
}

/**
 * Park until the phone sends something for THIS session, it ends, or we time
 * out. Only ever called with a session id matched exactly to the host agent's
 * own session id — never a cwd/most-recent guess — so an unrelated Claude
 * session can't be made to block here.
 *   reply  → print it, exit 0 (hook blocks the stop and hands it over)
 *   ended  → exit 0 (hook lets the turn stop)
 *   timeout→ exit 3 (hook re-parks with a heartbeat)
 */
function waitForReplies(sessionId: string, timeoutSec: number): void {
  // Parked between turns = idle: the phone can tell "waiting for you" apart
  // from "actively working". Draining a reply flips it back to working.
  const parked = readRemote(sessionId)
  if (parked && parked.status === 'working')
    writeRemote({ ...parked, status: 'idle', lastSeenAt: Date.now() })
  const deadline = Date.now() + timeoutSec * 1000
  for (;;) {
    const session = readRemote(sessionId)
    if (!session || session.status === 'ended') return
    const replies = takeRemoteReplies(sessionId)
    if (replies.length) {
      // Blank line between queued messages so the agent sees the boundaries.
      console.log(replies.join('\n\n'))
      return
    }
    if (Date.now() > deadline) process.exit(3)
    execSync('sleep 2')
  }
}

function gitInfo(cwd: string): { repo: string; branch: string } {
  const run = (cmdline: string): string => {
    try {
      return execSync(cmdline, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
    } catch {
      return ''
    }
  }
  const root = run('git rev-parse --show-toplevel')
  return { repo: root ? basename(root) : basename(cwd), branch: run('git branch --show-current') }
}

export function remoteCommand(sub: string | undefined, rest: string[]): void {
  // --id may appear anywhere; everything else is positional.
  let id = ''
  let cwdFlag = ''
  let imageFlag = ''
  let agentSessionFlag = ''
  const positional: string[] = []
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--id') {
      id = rest[++i] || ''
      continue
    }
    if (rest[i].startsWith('--id=')) {
      id = rest[i].slice(5)
      continue
    }
    if (rest[i] === '--cwd') {
      cwdFlag = rest[++i] || ''
      continue
    }
    if (rest[i] === '--quiet') continue
    if (rest[i] === '--timeout') {
      i++
      continue
    }
    if (rest[i] === '--image') {
      imageFlag = rest[++i] || ''
      continue
    }
    if (rest[i] === '--agent-session') {
      agentSessionFlag = rest[++i] || ''
      continue
    }
    positional.push(rest[i])
  }
  const timeoutFlag = rest.findIndex((a) => a === '--timeout')
  const timeoutSec = timeoutFlag >= 0 ? Number(rest[timeoutFlag + 1]) || 900 : 900

  switch (sub) {
    case 'register': {
      const cwd = process.cwd()
      const { repo, branch } = gitInfo(cwd)
      const sessionId = validRemoteId(id) ? id : randomUUID().slice(0, 8)
      const existing = readRemote(sessionId)
      writeRemote({
        id: sessionId,
        title: positional[0] || existing?.title || repo || 'session',
        repo,
        branch,
        cwd,
        engine: process.env.TERMINAL_ENGINE || existing?.engine || '',
        // The host agent's own session id — the precise routing key so a reply
        // can never reach a different session sharing this repo. Engine-agnostic:
        // each engine exposes its own, and the returned --id works regardless.
        agentSessionId:
          process.env.GT_TERMINAL_SESSION_ID ||
          process.env.CLAUDE_CODE_SESSION_ID ||
          process.env.CODEX_SESSION_ID ||
          process.env.TERMINAL_REMOTE_AGENT_SESSION ||
          existing?.agentSessionId ||
          undefined,
        // 'phone' only when the session was SPAWNED from the phone (nobody at
        // this Mac) — that is the only case the Stop hook may park on. A local
        // /remote-terminal registration stays 'local' so it never blocks you.
        origin: rest.includes('--origin=phone') ? 'phone' : existing?.origin || 'local',
        status: 'working',
        registeredAt: existing?.registeredAt || Date.now(),
        lastSeenAt: Date.now(),
        deliveredUpTo: existing?.deliveredUpTo ?? 0,
      })
      console.log(sessionId)
      break
    }
    case 'post': {
      const sessionId = resolveRemoteId(id, cwdFlag || process.cwd(), { soft: true })
      const text = positional.join(' ').trim()
      const images = imageFlag ? [remoteSaveImage(sessionId, imageFlag)] : []
      if (!text && !images.length) {
        console.error('usage: terminal-cli remote post "<message>" [--image <path>]')
        process.exit(2)
      }
      // Deleted from the phone / never registered: this session simply isn't
      // remote. Drop the post with a soft notice — never crash the turn.
      if (!sessionId) {
        console.error('remote: no active session (unregistered or removed) — post skipped')
        break
      }
      remoteAppend(sessionId, 'agent', text, images)
      writeRemote({ ...(readRemote(sessionId) as RemoteSession), lastSeenAt: Date.now() })
      break
    }
    case 'ask': {
      const sessionId = resolveRemoteId(id, cwdFlag || process.cwd(), { soft: true })
      const question = positional.join(' ').trim()
      if (!question) {
        console.error('usage: terminal-cli remote ask "<question>" [--image <path>]')
        process.exit(2)
      }
      // No remote session to answer — behave like a timeout: no stdout, non-zero,
      // so the agent picks its safe default and carries on (per the skill).
      if (!sessionId) {
        console.error('remote: no active session to ask — proceed with a safe default')
        process.exit(3)
      }
      // A screenshot often IS the question ("which layout?") — attach like post.
      const askImages = imageFlag ? [remoteSaveImage(sessionId, imageFlag)] : []
      remoteAppend(sessionId, 'agent', question, askImages)
      writeRemote({
        ...(readRemote(sessionId) as RemoteSession),
        status: 'awaiting',
        question,
        lastSeenAt: Date.now(),
      })
      // Block until the phone answers. Polling a file keeps this dependency-free
      // and survives the app restarting underneath us.
      const deadline = Date.now() + timeoutSec * 1000
      for (;;) {
        const replies = takeRemoteReplies(sessionId)
        if (replies.length) {
          console.log(replies.join('\n\n'))
          return
        }
        if (Date.now() > deadline) {
          writeRemote({
            ...(readRemote(sessionId) as RemoteSession),
            status: 'working',
            question: undefined,
          })
          console.error(`no reply within ${timeoutSec}s`)
          process.exit(3)
        }
        execSync('sleep 2')
      }
    }
    case 'check': {
      // Non-blocking (default): prints anything queued while the agent was busy.
      // With --wait: BLOCKS, parking the turn until the phone sends something,
      // the session ends, or --timeout elapses. The Stop hook uses --wait so a
      // remote session never goes idle — it waits inside the hook for the next
      // instruction instead of ending the turn and dying. Silent with no
      // registration, because the hook calls it on EVERY turn of EVERY session.
      const quiet = rest.includes('--quiet')
      const wait = rest.includes('--wait')

      // BLOCKING path: resolve STRICTLY by the host agent's own session id — no
      // cwd or most-recent fallback. Those fallbacks are fine for post/ask (the
      // agent means "my session"), but here they were catastrophic: the Stop
      // hook runs in EVERY Claude session on the machine, so a fallback made an
      // unrelated session adopt some other registered thread and park for the
      // whole timeout — hanging normal sessions. No exact match ⇒ this session
      // is not a remote session ⇒ exit 0 immediately and let it stop.
      if (wait) {
        const sid = agentSessionFlag || process.env.CLAUDE_CODE_SESSION_ID || ''
        const mine = sid
          ? remoteList().find((s) => s.agentSessionId === sid && s.status !== 'ended')
          : null
        if (!mine) break
        // Only PHONE-SPAWNED sessions park. A session you registered with
        // /remote-terminal while sitting at this Mac must never block — you are
        // right here, and holding the turn for the timeout just hangs your work.
        // Those still get their queued replies, non-blocking.
        if (mine.origin !== 'phone') {
          const queued = takeRemoteReplies(mine.id)
          if (queued.length) console.log(queued.join('\n\n'))
          break
        }
        return waitForReplies(mine.id, timeoutSec)
      }

      const sessionId = resolveRemoteId(id, cwdFlag || process.cwd(), {
        quiet,
        agentSessionId: agentSessionFlag,
      })
      if (!sessionId) break
      const replies = takeRemoteReplies(sessionId)
      if (replies.length) console.log(replies.join('\n\n'))
      break
    }
    // 'end' / 'off' — come back to the desktop: stop being remote, keep the
    // history. Idempotent: ending an already-ended or already-deleted session
    // succeeds silently, so toggling off is never an error.
    case 'end':
    case 'off': {
      const sessionId = resolveRemoteId(id, cwdFlag || process.cwd(), {
        soft: true,
        agentSessionId: agentSessionFlag,
      })
      const session = sessionId ? readRemote(sessionId) : null
      if (session) writeRemote({ ...session, status: 'ended', lastSeenAt: Date.now() })
      break
    }
    // 'status' — is this session still on the phone? Prints working|awaiting|
    // ended|none so a human or agent can tell where a handoff stands.
    case 'status': {
      const sessionId = resolveRemoteId(id, cwdFlag || process.cwd(), {
        soft: true,
        agentSessionId: agentSessionFlag,
      })
      const session = sessionId ? readRemote(sessionId) : null
      console.log(session ? session.status : 'none')
      break
    }
    case 'list':
      console.log(JSON.stringify(remoteList(), null, 2))
      break
    default:
      console.error(
        'usage: terminal-cli remote <register|post|ask|check|end|off|status|list> [--id <id>] [args...]',
      )
      process.exit(2)
  }
}
