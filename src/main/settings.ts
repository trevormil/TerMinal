import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// Persisted, self-configuring app settings. Every key has a working default —
// a fresh install (no file) runs fine, and an empty string means "resolve at
// read time" (e.g. projectsDir → your home dir). Legacy files in the old
// { telegram, telegramControl } shape are migrated on read.

export type EngineId = 'codex' | 'claude' | 'cursor'
export type EngineCfg = {
  path: string // '' = use the bare binary name on PATH
  defaultModel: string // '' = let the engine pick its own default
}
export type ForgePref = 'auto' | 'github' | 'gitlab'
export type DaemonCfg = {
  projectsDir: string
  worktreesDir: string
  harnessDir: string
  templateRepo: string
  engines: Record<EngineId, EngineCfg>
  defaultEngine: EngineId
  forge: ForgePref
}
export type TelegramCfg = {
  notify: boolean // mirror notifications to Telegram (opt-in)
  control: boolean // accept inbound AFK commands from Telegram (opt-in)
  botToken: string // BotFather token → native Bot API (else falls back to scripts)
  chatId: string // the single authorized chat (auth boundary)
}
export type InboxCfg = {
  completionHook: boolean // Claude/Codex/Cursor completion hooks file Inbox items by default
  agentContextPreamble: boolean // prepend capped repo docs/learnings/decisions context to prompt-style runs
}
export type AppearanceMode = 'dark' | 'light' | 'system'
export type AppearanceTabLayout = 'horizontal' | 'sidebar'
export type AppearanceCfg = {
  mode: AppearanceMode
  theme: string
  accent: string
  uiScale: number
  tabLayout: AppearanceTabLayout
}
// External-app handoffs: macOS app names used with `open -a <name>` — robust
// (no PATH/CLI dependency). '' → the built-in default.
export type AppsCfg = {
  editor: string // e.g. "Cursor" / "Visual Studio Code" — "Open in editor"
  browser: string // e.g. "Brave Browser" — "Open in browser"
}
export type SuggestionsCfg = {
  aiEngine: EngineId
  aiModel: string
  autoEngine: EngineId
  autoModel: string
}
export type NoteFolder = {
  id: string
  title: string
  path: string
}
export type RemotePlatform = 'auto' | 'linux' | 'macos'
export type RemoteHost = {
  id: string
  label: string
  sshTarget: string // ssh config alias or user@host
  defaultCwd: string // '' = remote login shell home
  platform: RemotePlatform
  daemon: DaemonCfg
}
export type Settings = {
  onboarded: boolean
  projectsDir: string // '' → resolved to your home dir
  worktreesDir: string // '' → <projectsDir>/.worktrees
  engines: Record<EngineId, EngineCfg>
  defaultEngine: EngineId
  forge: ForgePref // 'auto' picks gh/glab per-repo from the remote host
  telegram: TelegramCfg
  inbox: InboxCfg
  appearance: AppearanceCfg
  apps: AppsCfg
  suggestions: SuggestionsCfg
  noteFolders: NoteFolder[]
  remoteHosts: RemoteHost[]
  harnessDir: string // optional cross-repo review-artifact store
  templateRepo: string // scaffold source
  fleetAdminUrl: string // '' → Admin tab hidden; set to embed the fleet meta-dashboard (personal)
}

// A patch may carry partial nested telegram/engines/apps without losing siblings.
export type SettingsPatch = Partial<Omit<Settings, 'telegram' | 'inbox' | 'appearance' | 'engines' | 'apps' | 'suggestions'>> & {
  telegram?: Partial<TelegramCfg>
  inbox?: Partial<InboxCfg>
  appearance?: Partial<AppearanceCfg>
  engines?: Partial<Record<EngineId, Partial<EngineCfg>>>
  apps?: Partial<AppsCfg>
  suggestions?: Partial<SuggestionsCfg>
  noteFolders?: NoteFolder[]
}

const DEFAULT_EDITOR = 'Cursor'
const DEFAULT_BROWSER = 'Brave Browser'

export const DEFAULT_TEMPLATE_REPO = 'https://github.com/trevormil/project-template'
const SECRET_MARKER = 'terminal-secret:v1'
const SECRET_PATHS = [
  ['telegram', 'botToken'],
  ['telegram', 'chatId'],
] as const

export type SettingsSecretStorage = {
  seal(value: string): string
  open(payload: string): string
  canEncrypt?: () => boolean
}
type EncryptedSecret = { __terminalSecret: typeof SECRET_MARKER; payload: string }
let secretStorage: SettingsSecretStorage | null = null

export function setSettingsSecretStorage(adapter: SettingsSecretStorage | null): void {
  secretStorage = adapter
}

export function defaultDaemonSettings(): DaemonCfg {
  return {
    projectsDir: '',
    worktreesDir: '',
    harnessDir: '',
    templateRepo: '',
    engines: {
      codex: { path: '', defaultModel: '' },
      claude: { path: '', defaultModel: '' },
      cursor: { path: '', defaultModel: '' },
    },
    defaultEngine: 'claude',
    forge: 'auto',
  }
}

export function defaultSettings(): Settings {
  const daemon = defaultDaemonSettings()
  return {
    onboarded: false,
    projectsDir: daemon.projectsDir,
    worktreesDir: daemon.worktreesDir,
    engines: daemon.engines,
    defaultEngine: daemon.defaultEngine, // claude is the required engine; codex is optional
    forge: daemon.forge,
    telegram: { notify: false, control: false, botToken: '', chatId: '' },
    inbox: { completionHook: true, agentContextPreamble: true },
    appearance: { mode: 'dark', theme: 'terminal', accent: '', uiScale: 1, tabLayout: 'horizontal' },
    apps: { editor: '', browser: '' },
    suggestions: {
      aiEngine: 'claude',
      aiModel: 'haiku',
      autoEngine: 'claude',
      autoModel: 'sonnet',
    },
    noteFolders: [],
    remoteHosts: [],
    harnessDir: daemon.harnessDir,
    templateRepo: daemon.templateRepo,
    fleetAdminUrl: '',
  }
}

function engineCfg(raw: unknown): EngineCfg {
  const out: EngineCfg = { path: '', defaultModel: '' }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (typeof r.path === 'string') out.path = r.path
  if (typeof r.defaultModel === 'string') out.defaultModel = r.defaultModel
  return out
}

function daemonCfg(raw: unknown): DaemonCfg {
  const out = defaultDaemonSettings()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const k of ['projectsDir', 'worktreesDir', 'harnessDir', 'templateRepo'] as const) {
    if (typeof r[k] === 'string') out[k] = r[k]
  }
  if (r.defaultEngine === 'codex' || r.defaultEngine === 'claude' || r.defaultEngine === 'cursor') out.defaultEngine = r.defaultEngine
  if (r.forge === 'auto' || r.forge === 'github' || r.forge === 'gitlab') out.forge = r.forge
  if (r.engines && typeof r.engines === 'object') {
    const engines = r.engines as Record<string, unknown>
    for (const e of ['codex', 'claude', 'cursor'] as EngineId[]) out.engines[e] = engineCfg(engines[e])
  }
  return out
}

function remoteHosts(raw: unknown): RemoteHost[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => {
      const sshTarget = typeof x.sshTarget === 'string' ? x.sshTarget.trim() : ''
      const idRaw = typeof x.id === 'string' ? x.id.trim() : ''
      const id = (idRaw || sshTarget).replace(/[^\w.-]/g, '-').replace(/^-+|-+$/g, '')
      const platform: RemotePlatform =
        x.platform === 'linux' || x.platform === 'macos' || x.platform === 'auto'
          ? x.platform
          : 'auto'
      return {
        id,
        label:
          typeof x.label === 'string' && x.label.trim()
            ? x.label.trim()
            : id || sshTarget,
        sshTarget,
        defaultCwd: typeof x.defaultCwd === 'string' ? x.defaultCwd.trim() : '',
        platform,
        daemon: daemonCfg(x.daemon),
      }
    })
    .filter((h) => h.id && h.sshTarget)
}

function noteFolders(raw: unknown): NoteFolder[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => {
      const path = typeof x.path === 'string' ? x.path.trim() : ''
      const title =
        typeof x.title === 'string' && x.title.trim()
          ? x.title.trim()
          : path.split('/').filter(Boolean).pop() || 'Notes'
      const rawId = typeof x.id === 'string' ? x.id.trim() : title
      let id = rawId.replace(/[^\w.-]/g, '-').replace(/^-+|-+$/g, '') || 'notes'
      let i = 2
      while (seen.has(id)) id = `${id}-${i++}`
      seen.add(id)
      return { id, title, path }
    })
    .filter((f) => f.path)
}

/** Coerce any on-disk shape (incl. the legacy flat booleans) into Settings. */
export function migrate(raw: unknown): Settings {
  const s = defaultSettings()
  if (!raw || typeof raw !== 'object') return s
  const r = raw as Record<string, any>

  // legacy flat booleans (pre-nesting)
  if (typeof r.telegram === 'boolean') s.telegram.notify = r.telegram
  if (typeof r.telegramControl === 'boolean') s.telegram.control = r.telegramControl
  // new nested telegram
  if (r.telegram && typeof r.telegram === 'object') {
    if (typeof r.telegram.notify === 'boolean') s.telegram.notify = r.telegram.notify
    if (typeof r.telegram.control === 'boolean') s.telegram.control = r.telegram.control
    if (typeof r.telegram.botToken === 'string') s.telegram.botToken = r.telegram.botToken
    if (typeof r.telegram.chatId === 'string') s.telegram.chatId = r.telegram.chatId
  }
  if (r.inbox && typeof r.inbox === 'object') {
    if (typeof r.inbox.completionHook === 'boolean') s.inbox.completionHook = r.inbox.completionHook
    if (typeof r.inbox.agentContextPreamble === 'boolean') s.inbox.agentContextPreamble = r.inbox.agentContextPreamble
  }
  if (r.appearance && typeof r.appearance === 'object') {
    if (r.appearance.mode === 'dark' || r.appearance.mode === 'light' || r.appearance.mode === 'system') {
      s.appearance.mode = r.appearance.mode
    }
    if (typeof r.appearance.theme === 'string' && r.appearance.theme.trim()) s.appearance.theme = r.appearance.theme
    if (typeof r.appearance.accent === 'string') s.appearance.accent = r.appearance.accent
    if (typeof r.appearance.uiScale === 'number' && Number.isFinite(r.appearance.uiScale)) {
      s.appearance.uiScale = Math.min(1.35, Math.max(0.85, r.appearance.uiScale))
    }
    if (r.appearance.tabLayout === 'horizontal' || r.appearance.tabLayout === 'sidebar') {
      s.appearance.tabLayout = r.appearance.tabLayout
    }
  }

  if (typeof r.onboarded === 'boolean') s.onboarded = r.onboarded
  for (const k of ['projectsDir', 'worktreesDir', 'harnessDir', 'templateRepo', 'fleetAdminUrl'] as const) {
    if (typeof r[k] === 'string') s[k] = r[k]
  }
  if (r.defaultEngine === 'codex' || r.defaultEngine === 'claude' || r.defaultEngine === 'cursor') s.defaultEngine = r.defaultEngine
  if (r.forge === 'auto' || r.forge === 'github' || r.forge === 'gitlab') s.forge = r.forge
  if (r.engines && typeof r.engines === 'object') {
    for (const e of ['codex', 'claude', 'cursor'] as EngineId[]) {
      s.engines[e] = engineCfg(r.engines[e])
    }
  }
  if (r.apps && typeof r.apps === 'object') {
    if (typeof r.apps.editor === 'string') s.apps.editor = r.apps.editor
    if (typeof r.apps.browser === 'string') s.apps.browser = r.apps.browser
  }
  if (r.suggestions && typeof r.suggestions === 'object') {
    if (
      r.suggestions.aiEngine === 'codex' ||
      r.suggestions.aiEngine === 'claude' ||
      r.suggestions.aiEngine === 'cursor'
    ) {
      s.suggestions.aiEngine = r.suggestions.aiEngine
    }
    if (typeof r.suggestions.aiModel === 'string') {
      s.suggestions.aiModel = r.suggestions.aiModel.trim()
    }
    if (
      r.suggestions.autoEngine === 'codex' ||
      r.suggestions.autoEngine === 'claude' ||
      r.suggestions.autoEngine === 'cursor'
    ) {
      s.suggestions.autoEngine = r.suggestions.autoEngine
    }
    if (typeof r.suggestions.autoModel === 'string') {
      s.suggestions.autoModel = r.suggestions.autoModel.trim()
    }
  }
  s.noteFolders = noteFolders(r.noteFolders)
  s.remoteHosts = remoteHosts(r.remoteHosts)
  return s
}

const FILE = join(homedir(), '.config', 'TerMinal', 'settings.json')

function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  return !!value && typeof value === 'object' && (value as Record<string, unknown>).__terminalSecret === SECRET_MARKER && typeof (value as Record<string, unknown>).payload === 'string'
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function transformSecretPaths(raw: unknown, visit: (value: unknown) => unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const out = clonePlain(raw)
  for (const [section, key] of SECRET_PATHS) {
    const parent = (out as Record<string, any>)[section]
    if (parent && typeof parent === 'object' && key in parent) {
      parent[key] = visit(parent[key])
    }
  }
  return out
}

export function openSettingsFromDisk(raw: unknown, storage: SettingsSecretStorage | null = secretStorage): unknown {
  return transformSecretPaths(raw, (value) => {
    if (!isEncryptedSecret(value)) return value
    if (!storage) return ''
    try {
      return storage.open(value.payload)
    } catch {
      return ''
    }
  })
}

export function sealSettingsForDisk(settings: Settings, storage: SettingsSecretStorage | null = secretStorage): unknown {
  const canEncrypt = !!storage && (storage.canEncrypt ? storage.canEncrypt() : true)
  return transformSecretPaths(settings, (value) => {
    if (typeof value !== 'string' || !value || !canEncrypt || !storage) return value
    return { __terminalSecret: SECRET_MARKER, payload: storage.seal(value) } satisfies EncryptedSecret
  })
}

let cache: Settings | null = null
export function readSettings(): Settings {
  if (cache) return cache
  try {
    cache = migrate(openSettingsFromDisk(JSON.parse(readFileSync(FILE, 'utf8'))))
  } catch {
    cache = defaultSettings()
  }
  return cache
}

/** Deep-merge a patch over current settings (telegram/engines merge per-key). */
export function mergeSettingsPatch(cur: Settings, patch: SettingsPatch): Settings {
  const legacyPatch = patch as SettingsPatch & Record<string, unknown>
  const {
    telegram,
    inbox,
    appearance,
    apps,
    engines,
    suggestions,
    noteFolders: patchNoteFolders,
    ...scalarPatch
  } = legacyPatch
  delete (scalarPatch as Record<string, unknown>)['open' + 'router']
  return {
    ...cur,
    ...scalarPatch,
    telegram: { ...cur.telegram, ...(telegram || {}) },
    inbox: { ...cur.inbox, ...(inbox || {}) },
    appearance: { ...cur.appearance, ...(appearance || {}) },
    apps: { ...cur.apps, ...(apps || {}) },
    engines: {
      codex: { ...cur.engines.codex, ...(engines?.codex || {}) },
      claude: { ...cur.engines.claude, ...(engines?.claude || {}) },
      cursor: { ...cur.engines.cursor, ...(engines?.cursor || {}) },
    },
    suggestions: { ...cur.suggestions, ...(suggestions || {}) },
    noteFolders: patchNoteFolders ? noteFolders(patchNoteFolders) : cur.noteFolders,
  }
}

/** Deep-merge a patch over current settings (telegram/engines merge per-key). */
export function patchSettings(patch: SettingsPatch): Settings {
  const next = mergeSettingsPatch(readSettings(), patch)
  cache = next
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(sealSettingsForDisk(next), null, 2))
  } catch {
    /* best effort */
  }
  return next
}

// --- resolution: turn '' defaults into concrete paths ------------------------

/** Pure: where worktrees live, given a settings value + a resolved projects dir. */
export function worktreesFrom(worktreesDir: string, projectsResolved: string): string {
  return worktreesDir || join(projectsResolved, '.worktrees')
}

export type ProjectsDirValidation =
  | { ok: true; dir: string }
  | { ok: false; reason: 'is-repo'; dir: string; suggestedParent: string; message: string }

export function classifyProjectsDir(
  dir: string,
  hasGitDir: (d: string) => boolean,
): ProjectsDirValidation {
  const trimmed = dir.trim()
  if (!trimmed) return { ok: true, dir: '' }
  if (!hasGitDir(trimmed)) return { ok: true, dir: trimmed }
  const suggestedParent = dirname(trimmed)
  return {
    ok: false,
    reason: 'is-repo',
    dir: trimmed,
    suggestedParent,
    message: `Projects folder points at a git repo. Use its parent folder instead: ${suggestedParent}`,
  }
}

export function resolvedProjectsDir(): string {
  return readSettings().projectsDir || homedir()
}

export function resolvedWorktreesDir(): string {
  return worktreesFrom(readSettings().worktreesDir, resolvedProjectsDir())
}

/** Optional cross-repo review-artifact store. '' (default) = none; the in-repo
 *  project reviews dir is the primary source and needs no configuration. */
export function resolvedHarnessDir(): string {
  return readSettings().harnessDir
}

export function resolvedTemplateRepo(): string {
  return readSettings().templateRepo || DEFAULT_TEMPLATE_REPO
}

/** The binary to invoke for an engine: explicit path > env override > bare name. */
export function enginePath(engine: EngineId): string {
  const p = readSettings().engines[engine]?.path
  if (p) return p
  if (engine === 'claude' && process.env.GT_CLAUDE_BIN) return process.env.GT_CLAUDE_BIN
  if (engine === 'cursor' && process.env.GT_CURSOR_BIN) return process.env.GT_CURSOR_BIN
  if (engine === 'cursor') return 'cursor-agent'
  return engine
}

/** Per-engine model fallback. Returns '' when no fallback is set, in which
 *  case callers should let the engine pick its own default. */
export function engineDefaultModel(engine: EngineId): string {
  return readSettings().engines[engine]?.defaultModel || ''
}

export function resolveEngineModel(engine: EngineId, model?: string, daemon?: DaemonCfg): string {
  const explicit = model?.trim()
  if (explicit) return explicit
  return daemon ? daemon.engines[engine]?.defaultModel || '' : engineDefaultModel(engine)
}

export const telegramNotifyEnabled = () => readSettings().telegram.notify
export const telegramControlEnabled = () => readSettings().telegram.control

/** macOS app name for the "Open in editor" / "Open in browser" handoffs. */
export const resolvedEditorApp = () => readSettings().apps.editor || DEFAULT_EDITOR
export const resolvedBrowserApp = () => readSettings().apps.browser || DEFAULT_BROWSER
