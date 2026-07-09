// Paired-loop listener — the always-on, code-driven channel between the two live
// sessions of a live-paired loop (see .claude/skills/loop-driver). It lives in
// the persistent Electron main process, so unlike the CLI's notify bridge it
// never needs re-arming: the moment one role emits a handoff, the other role's
// session receives it — no LLM "keep listening" discretion involved.
//
// Base channel: events.jsonl in the loop state dir (provider-neutral — any
// engine can append one line). Claude fallback: if a Claude session completes a
// turn without writing an event, forward its transcript tail so the peer still
// gets nudged. Delivery is a raw write into the peer session's PTY + submit.

import { join } from 'node:path'
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { getLoop } from './loops'

type Role = 'driver' | 'worker'

type Deps = {
  /** Write raw bytes into a session's PTY (submit with a trailing "\r"). */
  writeToSession: (key: string, data: string) => boolean
  /** The engine transcript/session id for a session key, if started. */
  sessionIdOf: (key: string) => string | undefined
  /** Final assistant-turn text for a Claude transcript session id ('' if none). */
  lastAssistantText: (sessionId: string) => string
}

// session key -> loop membership
const members = new Map<string, { loopId: string; role: Role }>()
// loopId -> byte offset consumed in events.jsonl (seeded at end, no replay)
const offsets = new Map<string, number>()
// loopId -> ts of the last event we delivered (gates the Claude fallback)
const lastEventAt = new Map<string, number>()

export function registerLoopSession(key: string, loopId: string, role: Role): void {
  members.set(key, { loopId, role })
}
export function unregisterLoopSession(key: string): void {
  members.delete(key)
}

function peerKey(loopId: string, senderRole: Role): string | undefined {
  for (const [k, m] of members) if (m.loopId === loopId && m.role !== senderRole) return k
  return undefined
}

function activeLoopIds(): Set<string> {
  const ids = new Set<string>()
  for (const m of members.values()) ids.add(m.loopId)
  return ids
}

function eventsPath(loopId: string): string | null {
  const rec = getLoop(loopId)
  if (!rec) return null
  return join(rec.repoRoot, '.TerMinal', 'loops', loopId, 'events.jsonl')
}

// One line, no control chars, bounded — a PTY submit must not smuggle newlines
// (they'd submit early) or dump a whole transcript into the peer's input.
function oneLine(s: string, cap = 1800): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > cap ? flat.slice(0, cap) + ' …' : flat
}

function deliver(deps: Deps, peer: string, fromRole: Role, text: string): void {
  const body = oneLine(text)
  if (!body) return
  deps.writeToSession(peer, `[loop peer · ${fromRole}] ${body}\r`)
}

function readNewEvents(loopId: string): { role?: string; summary?: string; detail?: string }[] {
  const file = eventsPath(loopId)
  if (!file || !existsSync(file)) return []
  let size = 0
  try {
    size = statSync(file).size
  } catch {
    return []
  }
  const prev = offsets.get(loopId)
  // First sighting: seed at EOF so we don't replay the loop's history.
  if (prev === undefined) {
    offsets.set(loopId, size)
    return []
  }
  if (size <= prev) {
    if (size < prev) offsets.set(loopId, size) // file was reset (restart)
    return []
  }
  const len = size - prev
  const out: { role?: string; summary?: string; detail?: string }[] = []
  try {
    const fd = openSync(file, 'r')
    const buf = Buffer.alloc(len)
    readSync(fd, buf, 0, len, prev)
    closeSync(fd)
    for (const line of buf.toString('utf8').split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        out.push(JSON.parse(t))
      } catch {
        /* partial/!json line — skip */
      }
    }
  } catch {
    return []
  }
  offsets.set(loopId, size)
  return out
}

function tick(deps: Deps): void {
  for (const loopId of activeLoopIds()) {
    const events = readNewEvents(loopId)
    for (const ev of events) {
      const role = ev.role === 'driver' || ev.role === 'worker' ? (ev.role as Role) : null
      if (!role) continue
      const peer = peerKey(loopId, role)
      if (!peer) continue
      const text = [ev.summary, ev.detail].filter(Boolean).join(' — ')
      deliver(deps, peer, role, text)
      lastEventAt.set(loopId, Date.now())
    }
  }
}

// Claude fallback: a Claude paired session finished a turn. If no events.jsonl
// handoff landed for this loop recently, forward the transcript tail so the peer
// still gets the turn. Called from the main turn watcher (Claude-only by nature —
// codex/cursor have no ~/.claude transcript, so this no-ops for them).
export function noteLoopTurnComplete(key: string, deps: Deps): void {
  const m = members.get(key)
  if (!m) return
  if (Date.now() - (lastEventAt.get(m.loopId) ?? 0) < 6000) return // agent used events.jsonl
  const peer = peerKey(m.loopId, m.role)
  if (!peer) return
  const sid = deps.sessionIdOf(key)
  if (!sid) return
  const text = deps.lastAssistantText(sid)
  if (text) deliver(deps, peer, m.role, text)
}

let timer: ReturnType<typeof setInterval> | null = null
export function startLoopListener(deps: Deps): void {
  if (timer) return
  timer = setInterval(() => tick(deps), 1500)
  timer.unref?.()
}

/** Run one delivery pass synchronously (used by tests). */
export function runLoopListenerTick(deps: Deps): void {
  tick(deps)
}
