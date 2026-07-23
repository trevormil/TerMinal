import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { firstInstalledEditor, firstInstalledBrowser } from './apps'
import { DEFAULT_BRIDGE_PORT } from './bridge/identity'

// Persisted, self-configuring app settings. Every key has a working default —
// a fresh install (no file) runs fine, and an empty string means "resolve at
// read time" (e.g. projectsDir → your home dir). Legacy files in the old
// { telegram, telegramControl } shape are migrated on read.

export type EngineId = 'codex' | 'claude' | 'cursor' | 'openrouter' | 'hermes' | 'openai-compat'
export const ENGINE_IDS: EngineId[] = [
  'codex',
  'claude',
  'cursor',
  'openrouter',
  'hermes',
  'openai-compat',
]
export type EngineCfg = {
  path: string // '' = use the bare binary name on PATH
  defaultModel: string // '' = let the engine pick its own default
  baseUrl: string // openai-compat only: the self-hosted /v1 endpoint ('' elsewhere)
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
// Outbound alert channels (notify-channels.ts). Telegram keeps its own block
// above (telegram.notify is that channel's enable knob — inbound control lives
// there too); this covers the rest of the fan-out.
export type AlertsCfg = {
  desktop: { enabled: boolean } // Electron Notification; on by default (historical behavior)
  webhook: { enabled: boolean; url: string } // POST JSON; covers Slack/Discord incoming webhooks
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
// Mobile bridge (the TerMinal Remote iOS app). Off by default; nothing binds a
// port until it is on. The bearer token and TLS cert deliberately live OUTSIDE
// settings.json — see src/main/bridge/identity.ts for why.
export type BridgeCfg = {
  enabled: boolean
  port: number
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
export type PinnedPanel = { label: string; url: string }
export type Settings = {
  onboarded: boolean
  projectsDir: string // '' → resolved to your home dir
  worktreesDir: string // '' → <projectsDir>/.worktrees
  engines: Record<EngineId, EngineCfg>
  defaultEngine: EngineId
  forge: ForgePref // 'auto' picks gh/glab per-repo from the remote host
  telegram: TelegramCfg
  alerts: AlertsCfg
  inbox: InboxCfg
  bridge: BridgeCfg
  appearance: AppearanceCfg
  apps: AppsCfg
  suggestions: SuggestionsCfg
  noteFolders: NoteFolder[]
  remoteHosts: RemoteHost[]
  harnessDir: string // optional cross-repo review-artifact store
  // Max agent runs loaded into memory at startup (the Runs-tab working set). Run
  // logs on disk are NEVER auto-deleted (storage is cheap — prune manually); this
  // only bounds RAM so a huge archive doesn't bloat the process. 0 = load all.
  runMemoryCap: number
  templateRepo: string // scaffold source
  pinnedPanels: PinnedPanel[] // web dashboards pinned as the Panels tab; [] → tab hidden (personal)
  openrouterApiKey: string // sealed; injected as OPENROUTER_API_KEY for OpenRouter (or-agent) runs. '' → fall back to process env
  openaiCompatApiKey: string // sealed; injected as OPENAI_API_KEY for openai-compat (or-agent) runs. '' → fall back to process env
}

// A patch may carry partial nested telegram/engines/apps without losing siblings.
export type SettingsPatch = Partial<
  Omit<
    Settings,
    'telegram' | 'alerts' | 'inbox' | 'bridge' | 'appearance' | 'engines' | 'apps' | 'suggestions'
  >
> & {
  telegram?: Partial<TelegramCfg>
  alerts?: {
    desktop?: Partial<AlertsCfg['desktop']>
    webhook?: Partial<AlertsCfg['webhook']>
  }
  inbox?: Partial<InboxCfg>
  bridge?: Partial<BridgeCfg>
  appearance?: Partial<AppearanceCfg>
  engines?: Partial<Record<EngineId, Partial<EngineCfg>>>
  apps?: Partial<AppsCfg>
  suggestions?: Partial<SuggestionsCfg>
  noteFolders?: NoteFolder[]
}

const DEFAULT_EDITOR = 'Cursor'
const DEFAULT_BROWSER = 'Brave Browser'

// The template is embedded in the TerMinal repo (templates/project-template);
// a clone of this repo resolves to that subdir (see pickTemplateSource).
export const DEFAULT_TEMPLATE_REPO = 'https://github.com/trevormil/TerMinal'
const SECRET_MARKER = 'terminal-secret:v1'
const SECRET_PATHS = [
  ['telegram', 'botToken'],
  ['telegram', 'chatId'],
  ['alerts', 'webhook', 'url'], // Slack/Discord webhook URLs embed a secret token
  ['openrouterApiKey'],
  ['openaiCompatApiKey'],
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
      codex: { path: '', defaultModel: '', baseUrl: '' },
      claude: { path: '', defaultModel: '', baseUrl: '' },
      cursor: { path: '', defaultModel: '', baseUrl: '' },
      openrouter: { path: '', defaultModel: '', baseUrl: '' },
      hermes: { path: '', defaultModel: '', baseUrl: '' },
      'openai-compat': { path: '', defaultModel: '', baseUrl: '' },
    },
    defaultEngine: 'codex',
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
    defaultEngine: daemon.defaultEngine, // codex is the default agent-run engine; claude stays selectable
    forge: daemon.forge,
    telegram: { notify: false, control: false, botToken: '', chatId: '' },
    alerts: { desktop: { enabled: true }, webhook: { enabled: false, url: '' } },
    inbox: { completionHook: true, agentContextPreamble: true },
    bridge: { enabled: false, port: DEFAULT_BRIDGE_PORT },
    appearance: {
      mode: 'dark',
      theme: 'terminal',
      accent: '',
      uiScale: 1,
      tabLayout: 'horizontal',
    },
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
    runMemoryCap: 1000,
    templateRepo: daemon.templateRepo,
    pinnedPanels: [],
    openrouterApiKey: '',
    openaiCompatApiKey: '',
  }
}

function engineCfg(raw: unknown): EngineCfg {
  const out: EngineCfg = { path: '', defaultModel: '', baseUrl: '' }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (typeof r.path === 'string') out.path = r.path
  if (typeof r.defaultModel === 'string') out.defaultModel = r.defaultModel
  if (typeof r.baseUrl === 'string') out.baseUrl = r.baseUrl.trim()
  return out
}

function daemonCfg(raw: unknown): DaemonCfg {
  const out = defaultDaemonSettings()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const k of ['projectsDir', 'worktreesDir', 'harnessDir', 'templateRepo'] as const) {
    if (typeof r[k] === 'string') out[k] = r[k]
  }
  if (ENGINE_IDS.includes(r.defaultEngine as EngineId))
    out.defaultEngine = r.defaultEngine as EngineId
  if (r.forge === 'auto' || r.forge === 'github' || r.forge === 'gitlab') out.forge = r.forge
  if (r.engines && typeof r.engines === 'object') {
    const engines = r.engines as Record<string, unknown>
    for (const e of ENGINE_IDS) out.engines[e] = engineCfg(engines[e])
  }
  return out
}

function remoteHosts(raw: unknown): RemoteHost[] {
  if (!Array.isArray(raw)) return []
  return (
    raw
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
          label: typeof x.label === 'string' && x.label.trim() ? x.label.trim() : id || sshTarget,
          sshTarget,
          defaultCwd: typeof x.defaultCwd === 'string' ? x.defaultCwd.trim() : '',
          platform,
          daemon: daemonCfg(x.daemon),
        }
      })
      // Drop hosts whose sshTarget could be parsed by `ssh` as an option
      // (leading `-`, e.g. `-oProxyCommand=…` → local RCE) or carries control
      // chars. Mirrors isSafeSshTarget in remote.ts (kept inline to avoid a
      // settings↔remote import cycle).
      .filter(
        (h) => h.id && h.sshTarget && !h.sshTarget.startsWith('-') && !/[\0\r\n]/.test(h.sshTarget),
      )
  )
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
  if (r.alerts && typeof r.alerts === 'object') {
    if (typeof r.alerts.desktop?.enabled === 'boolean')
      s.alerts.desktop.enabled = r.alerts.desktop.enabled
    if (typeof r.alerts.webhook?.enabled === 'boolean')
      s.alerts.webhook.enabled = r.alerts.webhook.enabled
    if (typeof r.alerts.webhook?.url === 'string') s.alerts.webhook.url = r.alerts.webhook.url
  }
  if (r.inbox && typeof r.inbox === 'object') {
    if (typeof r.inbox.completionHook === 'boolean') s.inbox.completionHook = r.inbox.completionHook
    if (typeof r.inbox.agentContextPreamble === 'boolean')
      s.inbox.agentContextPreamble = r.inbox.agentContextPreamble
  }
  if (r.appearance && typeof r.appearance === 'object') {
    if (
      r.appearance.mode === 'dark' ||
      r.appearance.mode === 'light' ||
      r.appearance.mode === 'system'
    ) {
      s.appearance.mode = r.appearance.mode
    }
    if (typeof r.appearance.theme === 'string' && r.appearance.theme.trim())
      s.appearance.theme = r.appearance.theme
    if (typeof r.appearance.accent === 'string') s.appearance.accent = r.appearance.accent
    if (typeof r.appearance.uiScale === 'number' && Number.isFinite(r.appearance.uiScale)) {
      s.appearance.uiScale = Math.min(1.35, Math.max(0.85, r.appearance.uiScale))
    }
    if (r.appearance.tabLayout === 'horizontal' || r.appearance.tabLayout === 'sidebar') {
      s.appearance.tabLayout = r.appearance.tabLayout
    }
  }

  if (typeof r.onboarded === 'boolean') s.onboarded = r.onboarded
  for (const k of ['projectsDir', 'worktreesDir', 'harnessDir', 'templateRepo'] as const) {
    if (typeof r[k] === 'string') s[k] = r[k]
  }
  if (Array.isArray(r.pinnedPanels)) {
    s.pinnedPanels = r.pinnedPanels
      .filter((p: unknown): p is PinnedPanel => !!p && typeof (p as PinnedPanel).url === 'string')
      .map((p: PinnedPanel) => ({ label: String(p.label ?? p.url), url: String(p.url) }))
  } else if (typeof r.fleetAdminUrl === 'string' && r.fleetAdminUrl.trim()) {
    s.pinnedPanels = [{ label: 'Fleet', url: r.fleetAdminUrl.trim() }] // migrate legacy single-URL setting
  }
  if (typeof r.openrouterApiKey === 'string') s.openrouterApiKey = r.openrouterApiKey
  if (typeof r.openaiCompatApiKey === 'string') s.openaiCompatApiKey = r.openaiCompatApiKey
  if (ENGINE_IDS.includes(r.defaultEngine as EngineId))
    s.defaultEngine = r.defaultEngine as EngineId
  if (r.forge === 'auto' || r.forge === 'github' || r.forge === 'gitlab') s.forge = r.forge
  if (r.engines && typeof r.engines === 'object') {
    for (const e of ENGINE_IDS) {
      s.engines[e] = engineCfg(r.engines[e])
    }
  }
  if (r.apps && typeof r.apps === 'object') {
    if (typeof r.apps.editor === 'string') s.apps.editor = r.apps.editor
    if (typeof r.apps.browser === 'string') s.apps.browser = r.apps.browser
  }
  if (r.suggestions && typeof r.suggestions === 'object') {
    if (ENGINE_IDS.includes(r.suggestions.aiEngine as EngineId)) {
      s.suggestions.aiEngine = r.suggestions.aiEngine as EngineId
    }
    if (typeof r.suggestions.aiModel === 'string') {
      s.suggestions.aiModel = r.suggestions.aiModel.trim()
    }
    if (ENGINE_IDS.includes(r.suggestions.autoEngine as EngineId)) {
      s.suggestions.autoEngine = r.suggestions.autoEngine as EngineId
    }
    if (typeof r.suggestions.autoModel === 'string') {
      s.suggestions.autoModel = r.suggestions.autoModel.trim()
    }
  }
  if (r.bridge && typeof r.bridge === 'object') {
    if (typeof r.bridge.enabled === 'boolean') s.bridge.enabled = r.bridge.enabled
    // A bad port would leave the bridge permanently unable to bind; fall back
    // to the default rather than persisting something unusable.
    const port = Number(r.bridge.port)
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) s.bridge.port = port
  }
  s.noteFolders = noteFolders(r.noteFolders)
  s.remoteHosts = remoteHosts(r.remoteHosts)
  if (typeof r.runMemoryCap === 'number' && r.runMemoryCap >= 0)
    s.runMemoryCap = Math.floor(r.runMemoryCap)
  return s
}

const FILE = join(homedir(), '.config', 'TerMinal', 'settings.json')

function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).__terminalSecret === SECRET_MARKER &&
    typeof (value as Record<string, unknown>).payload === 'string'
  )
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function transformSecretPaths(raw: unknown, visit: (value: unknown) => unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const out = clonePlain(raw)
  for (const path of SECRET_PATHS) {
    let parent: any = out
    for (let i = 0; i < path.length - 1; i++) {
      parent = parent?.[path[i]]
      if (!parent || typeof parent !== 'object') break
    }
    const leaf = path[path.length - 1]
    if (parent && typeof parent === 'object' && leaf in parent) {
      parent[leaf] = visit(parent[leaf])
    }
  }
  return out
}

export function openSettingsFromDisk(
  raw: unknown,
  storage: SettingsSecretStorage | null = secretStorage,
): unknown {
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

export function sealSettingsForDisk(
  settings: Settings,
  storage: SettingsSecretStorage | null = secretStorage,
): unknown {
  const canEncrypt = !!storage && (storage.canEncrypt ? storage.canEncrypt() : true)
  return transformSecretPaths(settings, (value) => {
    if (typeof value !== 'string' || !value) return value
    if (!canEncrypt || !storage) {
      // Never write a secret in cleartext. When OS encryption is unavailable
      // (keychain locked/denied, unsigned/dev build) omit the value from disk —
      // the in-memory setting still works for this session; the user re-enters
      // it if needed. Returning undefined drops the key from the serialized JSON.
      console.error(
        '[gt] settings: OS encryption unavailable — omitting a secret from disk instead of writing cleartext',
      )
      return undefined
    }
    return {
      __terminalSecret: SECRET_MARKER,
      payload: storage.seal(value),
    } satisfies EncryptedSecret
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
    alerts,
    inbox,
    bridge,
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
    alerts: {
      desktop: { ...cur.alerts.desktop, ...(alerts?.desktop || {}) },
      webhook: { ...cur.alerts.webhook, ...(alerts?.webhook || {}) },
    },
    inbox: { ...cur.inbox, ...(inbox || {}) },
    bridge: { ...cur.bridge, ...(bridge || {}) },
    appearance: { ...cur.appearance, ...(appearance || {}) },
    apps: { ...cur.apps, ...(apps || {}) },
    engines: {
      codex: { ...cur.engines.codex, ...(engines?.codex || {}) },
      claude: { ...cur.engines.claude, ...(engines?.claude || {}) },
      cursor: { ...cur.engines.cursor, ...(engines?.cursor || {}) },
      openrouter: { ...cur.engines.openrouter, ...(engines?.openrouter || {}) },
      hermes: { ...cur.engines.hermes, ...(engines?.hermes || {}) },
      'openai-compat': { ...cur.engines['openai-compat'], ...(engines?.['openai-compat'] || {}) },
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
    // 0600: settings.json holds sealed secrets (and, when OS encryption is
    // available, nothing sensitive in cleartext) — but keep it owner-only
    // regardless so no other local user can read it. writeFileSync only applies
    // mode on create, so chmod a pre-existing file too.
    writeFileSync(FILE, JSON.stringify(sealSettingsForDisk(next), null, 2), { mode: 0o600 })
    try {
      chmodSync(FILE, 0o600)
    } catch {
      /* best effort */
    }
  } catch {
    /* best effort */
  }
  syncTelegramSidecar(next)
  return next
}

// --- telegram creds sidecar (out-of-process delivery) ------------------------
//
// The bin filers (terminal-cron / terminal-cli / terminal-mcp-server) file HITL
// items and ping Telegram from plain Bun processes that CANNOT call Electron
// safeStorage — so they can't decrypt the sealed token in settings.json. The
// app therefore mirrors the DECRYPTED creds to a 0600 sidecar those processes
// read. See resolveTelegramCreds for the read side (inlined identically in each
// bin script). Deleted when creds are cleared so stale creds never linger.
const TELEGRAM_SIDECAR = join(homedir(), '.config', 'TerMinal', 'telegram.local.json')

/** The creds worth mirroring (both fields present), or null to clear. */
export function telegramSidecarPayload(s: Settings): { botToken: string; chatId: string } | null {
  const { botToken, chatId } = s.telegram
  return botToken && chatId ? { botToken, chatId } : null
}

/**
 * Resolve usable Telegram creds for an out-of-process filer: prefer the 0600
 * sidecar, else a *plaintext* settings.json `telegram` block. A sealed
 * `{__terminalSecret}` object is NOT a usable token (can't be opened without
 * safeStorage), so it is skipped rather than sent as a broken request.
 *
 * Canonical impl + test target. bin/terminal-cron, bin/terminal-cli and
 * bin/terminal-mcp-server inline a byte-identical copy (they are self-contained,
 * no app-bundle imports) — keep them in sync with this.
 */
export function resolveTelegramCreds(
  sidecar: unknown,
  settingsTelegram: unknown,
): { botToken: string; chatId: string } | null {
  const pick = (o: unknown): { botToken: string; chatId: string } | null => {
    if (!o || typeof o !== 'object') return null
    const bt = (o as Record<string, unknown>).botToken
    const ci = (o as Record<string, unknown>).chatId
    return typeof bt === 'string' && bt && typeof ci === 'string' && ci
      ? { botToken: bt, chatId: ci }
      : null
  }
  return pick(sidecar) ?? pick(settingsTelegram)
}

/** Mirror decrypted telegram creds to the 0600 sidecar, or remove it when cleared. */
export function syncTelegramSidecar(s: Settings = readSettings()): void {
  try {
    const creds = telegramSidecarPayload(s)
    if (creds) {
      writeFileSync(TELEGRAM_SIDECAR, JSON.stringify(creds), { mode: 0o600 })
      // writeFileSync only applies mode on create; force-tighten a pre-existing file.
      try {
        chmodSync(TELEGRAM_SIDECAR, 0o600)
      } catch {
        /* best effort */
      }
    } else if (existsSync(TELEGRAM_SIDECAR)) {
      unlinkSync(TELEGRAM_SIDECAR)
    }
  } catch {
    /* best effort — telegram is a non-critical side channel */
  }
}

// --- resolution: turn '' defaults into concrete paths ------------------------

/** Pure: where worktrees live, given a settings value + a resolved projects dir. */
export function worktreesFrom(worktreesDir: string, projectsResolved: string): string {
  return worktreesDir || join(projectsResolved, '.worktrees')
}

export type ProjectsDirValidation =
  | { ok: true; dir: string; repoCount: number }
  | { ok: false; reason: 'is-repo'; dir: string; suggestedParent: string; message: string }
  | {
      ok: false
      reason: 'no-repos-found'
      dir: string
      suggestedChild?: string
      suggestedCount?: number
      message: string
    }

// Candidate parent folders scanned when auto-detecting a default projects dir,
// densest-first fallback. '' means the home folder itself. Keep in sync with the
// discovery rule in `bin/terminal-mcp-server` (`knownRepoRoots`): a repo is any
// immediate child directory containing a `.git` entry; dotfiles are skipped.
export const CANDIDATE_ROOT_NAMES = ['', 'workspace', 'code', 'projects', 'dev', 'src']

// fs-injected so it stays pure/unit-testable. Mirrors `knownRepoRoots`: one
// level down, skip dot-prefixed names, count children that contain `.git`.
export function countGitReposOneLevel(
  dir: string,
  fs: { listChildren: (d: string) => string[]; hasGitDir: (d: string) => boolean },
): number {
  let n = 0
  let children: string[]
  try {
    children = fs.listChildren(dir)
  } catch {
    return 0
  }
  for (const name of children) {
    if (name.startsWith('.')) continue
    if (fs.hasGitDir(join(dir, name))) n++
  }
  return n
}

/** Densest candidate root (ties resolve to the earliest in `candidates`, so the
 *  home folder wins a tie). Returns null when no candidate holds any repos. */
export function pickDensestRoot(
  candidates: string[],
  countFn: (d: string) => number,
): { root: string; count: number } | null {
  let best: { root: string; count: number } | null = null
  for (const root of candidates) {
    const count = countFn(root)
    if (count > 0 && (!best || count > best.count)) best = { root, count }
  }
  return best
}

export function classifyProjectsDir(
  dir: string,
  fs: {
    hasGitDir: (d: string) => boolean
    listChildren: (d: string) => string[]
    resolveHome: () => string
    /** Absolute paths for CANDIDATE_ROOT_NAMES, home-relative ('' → home). */
    candidateRoots?: () => string[]
  },
): ProjectsDirValidation {
  const trimmed = dir.trim()
  // A repo path is the rare mistake; flag it before anything else.
  if (trimmed && fs.hasGitDir(trimmed)) {
    const suggestedParent = dirname(trimmed)
    return {
      ok: false,
      reason: 'is-repo',
      dir: trimmed,
      suggestedParent,
      message: `Projects folder points at a git repo. Use its parent folder instead: ${suggestedParent}`,
    }
  }
  // Blank resolves to home at read time (see resolvedProjectsDir); count there
  // too so "leave blank" doesn't silently discover zero repos.
  const scanDir = trimmed || fs.resolveHome()
  const repoCount = countGitReposOneLevel(scanDir, fs)
  if (repoCount > 0) return { ok: true, dir: trimmed, repoCount }

  // Zero repos one level down — the common nested-layout failure. Suggest the
  // densest sibling candidate (e.g. ~/workspace) if one exists.
  const candidates = fs.candidateRoots ? fs.candidateRoots() : []
  const denser = pickDensestRoot(
    candidates.filter((c) => c !== scanDir),
    (d) => countGitReposOneLevel(d, fs),
  )
  const base = `No git repos found directly in ${scanDir || 'this folder'} — repos may be nested one level deeper.`
  return {
    ok: false,
    reason: 'no-repos-found',
    dir: trimmed,
    ...(denser ? { suggestedChild: denser.root, suggestedCount: denser.count } : {}),
    message: denser ? `${base} ${denser.root} holds ${denser.count} — use that instead?` : base,
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
  // OpenRouter AND openai-compat are driven by the or-agent harness (Codex on a
  // provider model; openai-compat points it at a custom base URL via env).
  // Prefer TerMinal's bundled copy, then a globally-installed one
  // (~/.claude/bin), else bare 'or-agent' (resolved on PATH).
  if (engine === 'openrouter' || engine === 'openai-compat') {
    const candidates = [
      join(homedir(), '.config', 'TerMinal', 'bin', 'or-agent'),
      join(homedir(), '.claude', 'bin', 'or-agent'),
    ]
    return candidates.find((p) => existsSync(p)) || 'or-agent'
  }
  return engine
}

/** Per-engine model fallback. Returns '' when no fallback is set, in which
 *  case callers should let the engine pick its own default. */
export function engineDefaultModel(engine: EngineId): string {
  return readSettings().engines[engine]?.defaultModel || ''
}

/** The OpenRouter key for or-agent/or-exec runs: the sealed Setting first, then
 *  a shell-inherited env var. '' → not configured (OpenRouter runs will fail). */
export function resolvedOpenRouterKey(): string {
  return readSettings().openrouterApiKey || process.env.OPENROUTER_API_KEY || ''
}

/** The openai-compat endpoint's key: sealed Setting, then shell env. '' is fine
 *  for keyless local servers — or-agent then requires a placeholder, which the
 *  runner injects (see agents.ts). */
export function resolvedOpenAICompatKey(): string {
  return readSettings().openaiCompatApiKey || process.env.OPENAI_API_KEY || ''
}

/** The openai-compat base URL from Settings ('' = not configured). */
export function openAICompatBaseUrl(): string {
  return readSettings().engines['openai-compat']?.baseUrl?.trim() || ''
}

export function resolveEngineModel(engine: EngineId, model?: string, daemon?: DaemonCfg): string {
  const explicit = model?.trim()
  if (explicit) return explicit
  return daemon ? daemon.engines[engine]?.defaultModel || '' : engineDefaultModel(engine)
}

export const telegramNotifyEnabled = () => readSettings().telegram.notify
export const telegramControlEnabled = () => readSettings().telegram.control

/** macOS app name for the "Open in editor" / "Open in browser" handoffs.
 *  Explicit setting > first detected installed app > hardcoded last resort, so a
 *  fresh user without Cursor/Brave still gets a working `open -a`. */
export const resolvedEditorApp = () =>
  readSettings().apps.editor || firstInstalledEditor() || DEFAULT_EDITOR
export const resolvedBrowserApp = () =>
  readSettings().apps.browser || firstInstalledBrowser() || DEFAULT_BROWSER
