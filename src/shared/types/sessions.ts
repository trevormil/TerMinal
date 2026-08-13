import type { Engine } from './agents'
import type { DaemonCfg, RemotePlatform } from './settings'

// One window now hosts MANY sessions, each its own PTY, keyed by a renderer-
// generated tab key. Data IPC reads the *active* session; PTY IPC is routed by
// key so every (even backgrounded) terminal keeps streaming.
export type SessionEngine = Engine | 'local'

export type RemoteSession = {
  hostId: string
  label: string
  sshTarget: string
  cwd?: string
  platform?: RemotePlatform
  daemon?: DaemonCfg
}

export type StartOpts = {
  mode: 'new' | 'resume'
  engine?: SessionEngine
  /** Per-session model override → passed as --model. Falls back to the engine's default. */
  model?: string
  /** Per-session reasoning-effort override. Falls back to the engine's
   *  configured default; dropped for engines without an effort control. */
  effort?: string
  sessionId?: string
  cwd?: string
  name?: string
  initialInput?: string
  ticketSlug?: string
  remote?: RemoteSession
  /** Live-paired loop linkage — set on the two sessions of a paired loop. */
  loopId?: string
  loopRole?: 'driver' | 'worker'
  /** Which harness runs an `openrouter` session (default 'codex'). */
  openrouterHarness?: 'codex' | 'hermes'
  cols: number
  rows: number
}

// Project sessions. v2 repos use .TerMinal/sessions; v1 repos use sessions/.
// Distinct from Claude Code sessions — these are the repo's live work docs.
export type ProjectSession = {
  slug: string
  id: number
  title: string
  status: string // active | closed | abandoned
  goal: string
  started: string
  ended: string
  anchor: string
  tickets: string[]
  branches: string[]
  prs: string[]
  body?: string
}

export type RemoteDirEntry = { name: string; path: string; dir: true }

export type RemoteDirList = {
  cwd: string
  parent: string
  entries: RemoteDirEntry[]
  error?: string
}
