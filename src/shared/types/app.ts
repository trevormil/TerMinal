export type BootstrapStatus = {
  state: BootstrapState
  bootstrapped: boolean
  missing: string[]
  message: string
}

export type BridgeStatus = {
  listening: boolean
  port: number
  error?: string
}

export type EnvDetect = {
  codex: { found: boolean; path: string }
  claude: { found: boolean; path: string }
  cursor: { found: boolean; path: string }
  hermes: { found: boolean; path: string }
  gh: { found: boolean; path: string; authed: boolean; authHost: string }
  glab: { found: boolean; path: string; authed: boolean; authHost: string }
  tgScripts: boolean
  apps: { editors: string[]; browsers: string[] }
}

export type UpdateCheckResult = {
  buildSha: string // short sha as baked, -dirty suffix stripped ('' → uncomparable)
  buildDirty: boolean // build was made from an uncommitted working tree
  status: UpdateStatus
  behindBy: number // commits origin/main is ahead of the build (when status 'behind')
  latestSha: string // short sha of origin/main when known
  source: 'git' | 'github' | 'none'
  checkedAt: number
  repoPath?: string // the source checkout used for the git check (for UI hints)
  checkoutBranch?: string // current branch of that checkout (git source only)
  checkoutDirty?: boolean // that checkout has local changes (git source only)
  error?: string
}

export type UsageWindow = { pct: number; resetsAt: number | null } | null

export type Usage = {
  ok: boolean
  plan: string
  tier: string
  fiveHour: UsageWindow
  sevenDay: UsageWindow
  overagePct: number | null
  stale: boolean
  error?: string
  ts: number
}

/** One turn handed to the cheap-LLM route (`llm:cheap`). */
export type CheapMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type PipelineId = 'single' | 'review' | 'review-iterate'

export type PresetKind = 'agents' | 'snippets'

export type PresetPrefs = {
  version: number
  hidden: Record<PresetKind, string[]>
}

export type SkillScope = 'project' | 'personal' | 'plugin'

export type SkillInfo = {
  name: string
  description: string
  scope: SkillScope
  namespace?: string // plugin name, for scope === 'plugin'
  platforms: SkillPlatform[]
}

export type PromptSnippet = {
  id: string
  title: string
  prompt: string
  description?: string
  group?: string
  source?: 'preset' | 'global' | 'repo'
}

export type CustomTab = {
  id: string
  title: string
  icon?: string
  source: 'global' | 'repo'
  url?: string
  command?: string
  intervalMs?: number
}

export type TabRunResult = { ok: boolean; html: string; code: number }

export type CommandWidget = {
  id: string
  title: string
  icon?: string
  command: string
  intervalMs: number
  mode: 'text' | 'big' | 'kv'
  source: 'global' | 'repo'
}

export type CommandResult = { ok: boolean; stdout: string; code: number }

export type ListenerDir = 'new' | 'processing' | 'done' | 'failed' | 'dead-letter'

export type ListenerStatus = {
  enabled: boolean
  inboxDir: string
  dirs: Record<ListenerDir, string>
  counts: Record<ListenerDir, number>
  listeners: {
    id: string
    source: string
    type: string
    name?: string
    total: number
    new: number
    processing: number
    done: number
    failed: number
    deadLetter: number
    lastAt: number
    lastStatus: ListenerDir
    lastTitle?: string
    lastResult?: string
    lastRunId?: string
    lastRunSource?: 'agent' | 'bg'
    repoRoot?: string
  }[]
  recent: {
    file: string
    dir: ListenerDir
    id?: string
    listenerId?: string
    listenerName?: string
    source?: string
    type?: string
    title?: string
    repo?: string
    repoRoot?: string
    processedAt?: number
    error?: string
    action?: string
    result?: string
    runId?: string
    runSource?: 'agent' | 'bg'
  }[]
}

export type UserPrompt = { text: string; ts: number }

export type BootstrapState = 'full' | 'partial' | 'none'

export type UpdateStatus = 'up-to-date' | 'behind' | 'diverged' | 'unknown'

export type SkillPlatform = 'claude' | 'codex' | 'cursor'
