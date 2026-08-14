// The shapes terminal-cli writes. Deliberately loose: every one of these files
// is also written by the app and by older versions of this script, so a field
// missing on disk is normal rather than a bug.

export type Severity = 'urgent' | 'normal' | 'low'

export type HitlItem = {
  id: string
  title: string
  action: string
  detail?: string
  repo: string
  repoRoot: string
  source: string
  status: string
  createdAt: number
  severity?: Severity
  category?: string
  runId?: string
  runSource?: string
  sessionId?: string
  terminalKey?: string
  terminalCwd?: string
  transcriptPath?: string
  slackChannel?: string
  slackTs?: string
}

export type ActivityEvent = {
  id: string
  ts: number
  kind: string
  title: string
  detail: string
  repo: string
  repoRoot: string
  runId?: string
  runSource?: string
  suppressTelegram?: boolean
}

export type RemoteSession = {
  id: string
  title?: string
  repo?: string
  branch?: string
  cwd?: string
  engine?: string
  agentSessionId?: string
  origin?: string
  status?: string
  question?: string
  registeredAt?: number
  lastSeenAt: number
  deliveredUpTo?: number
}

export type RemoteMessage = { at: number; from: string; text: string; images?: string[] }
