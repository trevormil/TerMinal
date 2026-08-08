import { readFileSync, existsSync, chmodSync, unlinkSync } from 'node:fs'
import { isHttpUrl } from '../shared/url-safety'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { quarantineCorruptFile, readJsonState, withFileLock, writeFileAtomic } from './atomic-write'
import { configPath } from './config-dir'
import { firstInstalledEditor, firstInstalledBrowser } from './apps'
import { DEFAULT_BRIDGE_PORT } from './bridge/identity'
import {
  NOTIFY_CATEGORIES,
  NOTIFY_CHANNELS,
  type NotifyCategory,
  type NotifyMatrix,
} from '../shared/notifications'
import { ENGINE_IDS, engineOf, type EngineId } from '../shared/engines'
import { normalizeDestination, type InboxDestination } from '../shared/slack'
import { expandSecretPaths } from './secret-paths'

// Persisted, self-configuring app settings. Every key has a working default —
// a fresh install (no file) runs fine, and an empty string means "resolve at
// read time" (e.g. projectsDir → your home dir). Legacy files in the old
// { telegram, telegramControl } shape are migrated on read.

// Derived from the shared registry (src/shared/engines.ts) — adding an engine
// there adds it everywhere, instead of drifting across the copies this replaced.
export { ENGINE_IDS, type EngineId }
export type EngineCfg = {
  path: string // '' = use the bare binary name on PATH
  defaultModel: string // '' = let the engine pick its own default
  defaultEffort: string // '' = engine default; validated against the registry level set
  baseUrl: string // openai-compat only: the self-hosted /v1 endpoint ('' elsewhere)
}

/** A blank config row for every registered engine. Replaces the hand-written
 *  per-engine blocks that had to be edited (in three places) per new engine. */
export function emptyEngineCfgs(): Record<EngineId, EngineCfg> {
  return Object.fromEntries(
    ENGINE_IDS.map((id) => [id, { path: '', defaultModel: '', defaultEffort: '', baseUrl: '' }]),
  ) as Record<EngineId, EngineCfg>
}

/** Merge stored engine rows over the defaults, tolerating unknown/missing ids. */
export function mergeEngineCfgs(
  cur: Partial<Record<EngineId, Partial<EngineCfg>>> | undefined,
  patch: Partial<Record<EngineId, Partial<EngineCfg>>> | undefined,
): Record<EngineId, EngineCfg> {
  const base = emptyEngineCfgs()
  for (const id of ENGINE_IDS) {
    base[id] = { ...base[id], ...(cur?.[id] || {}), ...(patch?.[id] || {}) }
  }
  return base
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
  // Minimum severity that fires a notification (push/Telegram/desktop). Below it,
  // items are inbox-only — email you sweep once or twice a day. Default 'urgent'.
  notifyThreshold: 'urgent' | 'normal' | 'low'
  // Where filings surface: the in-app Inbox, Slack, or both (shared/slack.ts).
  // 'slack' still persists every item to hitl.json — it only moves the nag.
  destination: InboxDestination
}
// Slack as an inbox destination (inbox.destination). A BOT token, not an
// incoming webhook: webhooks are pinned to one channel each, and the point is
// per-category channels (Monitoring/Certs → #inbox-monitoring-certs). Scopes:
// chat:write, channels:manage + channels:join (auto-create), reactions:write.
export type SlackCfg = {
  botToken: string // sealed; xoxb- bot token
  defaultChannel: string // Uncategorized + fallback channel, '#' optional
  channelPrefix: string // derived-channel prefix; '' → bare category slug
  autoCreateChannels: boolean // create+join missing public channels on first post
  // Slack member id (U…) auto-invited to every channel the bot creates. Bot-made
  // channels don't appear in anyone's sidebar until joined; without this, each
  // new category means a manual channel-browser hunt. '' → skip.
  inviteUserId: string
}
// Outbound alert channels (notify-channels.ts). Telegram keeps its own block
// above (telegram.notify is that channel's enable knob — inbound control lives
// there too); this covers the rest of the fan-out.
/**
 * One outbound webhook destination. Several can be configured at once — a Slack
 * URL, a Discord URL, your own endpoint — because they rarely want the same
 * traffic. `categories` overrides the notification matrix's `webhook` row for
 * THIS destination only; omitted means "whatever the row says".
 *
 * `id` is stable and load-bearing: it keys the sealed-secret path and matches a
 * patched entry back to its saved URL (the renderer only ever sees a mask).
 */
export type WebhookCfg = {
  id: string
  name: string
  url: string
  enabled: boolean
  categories?: Partial<Record<NotifyCategory, boolean>>
}
export type AlertsCfg = {
  desktop: { enabled: boolean } // Electron Notification; on by default (historical behavior)
  webhooks: WebhookCfg[] // POST JSON; covers Slack/Discord incoming webhooks
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
  formatOnSave: boolean // Files tab: run the project's prettier on ⌘S (opt-in)
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
/** User overrides on the notification matrix; {} means "all shipped defaults". */
export type NotificationsCfg = { matrix: NotifyMatrix }
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
  slack: SlackCfg
  /** Per-channel × per-category notification routing (see shared/notifications). */
  notifications: NotificationsCfg
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
  /** Allow repo-provided executable surfaces (.TerMinal/widgets.json +
   *  tabs.json). OFF by default: even with the per-repo trust/approval flow, a
   *  cloned repo getting command execution + in-app embeds is a real risk, so
   *  the surfaces don't exist at all unless the operator opts in globally. */
  allowRepoExtensions: boolean
}

// A patch may carry partial nested telegram/engines/apps without losing siblings.
export type SettingsPatch = Partial<
  Omit<
    Settings,
    | 'telegram'
    | 'alerts'
    | 'inbox'
    | 'slack'
    | 'bridge'
    | 'appearance'
    | 'engines'
    | 'apps'
    | 'suggestions'
  >
> & {
  telegram?: Partial<TelegramCfg>
  alerts?: {
    desktop?: Partial<AlertsCfg['desktop']>
    /** The whole list, always — see mergeWebhooks. Entries may omit `url`. */
    webhooks?: (Partial<WebhookCfg> & { id: string })[]
  }
  inbox?: Partial<InboxCfg>
  slack?: Partial<SlackCfg>
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
    engines: emptyEngineCfgs(),
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
    alerts: { desktop: { enabled: true }, webhooks: [] },
    inbox: {
      completionHook: true,
      agentContextPreamble: true,
      notifyThreshold: 'urgent',
      destination: 'inbox',
    },
    slack: {
      botToken: '',
      defaultChannel: '#terminal-inbox',
      channelPrefix: 'inbox',
      autoCreateChannels: true,
      inviteUserId: '',
    },
    notifications: { matrix: {} }, // {} = ship defaults (shared/notifications DEFAULT_MATRIX)
    bridge: { enabled: false, port: DEFAULT_BRIDGE_PORT },
    appearance: {
      mode: 'dark',
      theme: 'terminal',
      accent: '',
      uiScale: 1,
      tabLayout: 'horizontal',
    },
    apps: { editor: '', browser: '', formatOnSave: false },
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
    allowRepoExtensions: false,
  }
}

function engineCfg(raw: unknown): EngineCfg {
  const out: EngineCfg = { path: '', defaultModel: '', defaultEffort: '', baseUrl: '' }
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (typeof r.path === 'string') out.path = r.path
  if (typeof r.defaultModel === 'string') out.defaultModel = r.defaultModel
  if (typeof r.defaultEffort === 'string') out.defaultEffort = r.defaultEffort
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

/**
 * Coerce a raw webhook list into shape, dropping entries that aren't objects
 * and fields that aren't the right type — a hand-edited settings.json shouldn't
 * take out the whole alerts block. Ids are positional when absent so that
 * migrating the same file twice yields the same ids; without that, the sealed
 * URL and its entry would come apart on the next read.
 */
function normalizeWebhooks(raw: unknown[]): WebhookCfg[] {
  const out: WebhookCfg[] = []
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return
    const w = entry as Record<string, unknown>
    // An EMPTY url is kept: that's a destination the user just added and hasn't
    // pasted a URL into yet. It stays inert (createWebhookChannels requires a
    // valid http(s) url), but dropping it would delete the row mid-edit.
    if (typeof w.url !== 'string') return
    const cfg: WebhookCfg = {
      id: typeof w.id === 'string' && w.id ? w.id : `wh-${i}`,
      name: typeof w.name === 'string' && w.name.trim() ? w.name.trim() : 'Webhook',
      url: w.url,
      enabled: w.enabled === true,
    }
    const categories = normalizeCategories(w.categories)
    if (categories) cfg.categories = categories
    out.push(cfg)
  })
  return out
}

/** Only known categories with boolean values survive; `undefined` means "no
 *  overrides", which routes off the notification matrix's `webhook` row. */
function normalizeCategories(raw: unknown): Partial<Record<NotifyCategory, boolean>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: Partial<Record<NotifyCategory, boolean>> = {}
  for (const cat of NOTIFY_CATEGORIES) {
    if (typeof src[cat] === 'boolean') out[cat] = src[cat] as boolean
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Merge a patched webhook list over the saved one. The list is REPLACED (so a
 * delete sticks), but an entry arriving without a `url` keeps the saved one
 * matched by id — the renderer is handed masks, and stripMaskedSecrets removes
 * them before the patch lands, so every untouched entry arrives url-less.
 */
function mergeWebhooks(current: WebhookCfg[], patch: unknown): WebhookCfg[] {
  if (!Array.isArray(patch)) return current
  const saved = new Map(current.map((w) => [w.id, w.url]))
  const filled = patch.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const w = entry as Record<string, unknown>
    // ABSENT means "untouched, keep what's saved"; an empty STRING is an
    // explicit Clear. Collapsing the two would make the Clear button a no-op.
    if (typeof w.url === 'string') return w
    const url = saved.get(String(w.id))
    return url === undefined ? w : { ...w, url }
  })
  return normalizeWebhooks(filled)
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
    if (Array.isArray(r.alerts.webhooks)) s.alerts.webhooks = normalizeWebhooks(r.alerts.webhooks)
    // The pre-multi-webhook shape, still on every existing install's disk. The
    // saved URL is carried over even when disabled — otherwise turning the
    // channel back on means re-pasting a credential the user already gave us.
    else if (typeof r.alerts.webhook?.url === 'string' && r.alerts.webhook.url)
      s.alerts.webhooks = [
        {
          id: 'default',
          name: 'Webhook',
          url: r.alerts.webhook.url,
          enabled: r.alerts.webhook.enabled === true,
        },
      ]
  }
  if (r.inbox && typeof r.inbox === 'object') {
    if (typeof r.inbox.completionHook === 'boolean') s.inbox.completionHook = r.inbox.completionHook
    if (typeof r.inbox.agentContextPreamble === 'boolean')
      s.inbox.agentContextPreamble = r.inbox.agentContextPreamble
    if (
      r.inbox.notifyThreshold === 'urgent' ||
      r.inbox.notifyThreshold === 'normal' ||
      r.inbox.notifyThreshold === 'low'
    )
      s.inbox.notifyThreshold = r.inbox.notifyThreshold
    if (r.inbox.destination !== undefined)
      s.inbox.destination = normalizeDestination(r.inbox.destination)
  }
  if (r.slack && typeof r.slack === 'object') {
    if (typeof r.slack.botToken === 'string') s.slack.botToken = r.slack.botToken
    if (typeof r.slack.defaultChannel === 'string') s.slack.defaultChannel = r.slack.defaultChannel
    if (typeof r.slack.channelPrefix === 'string') s.slack.channelPrefix = r.slack.channelPrefix
    if (typeof r.slack.autoCreateChannels === 'boolean')
      s.slack.autoCreateChannels = r.slack.autoCreateChannels
    if (typeof r.slack.inviteUserId === 'string') s.slack.inviteUserId = r.slack.inviteUserId
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
  // A panel URL becomes an iframe `src`, so it is validated on the WRITE path as
  // well as at render (ticket 102). Rejecting only at render would let a
  // non-http value persist in settings and re-present itself to every future
  // reader — including one that forgets to check. Agents write settings here,
  // so "the user typed it" is not a trust argument.
  if (Array.isArray(r.pinnedPanels)) {
    s.pinnedPanels = r.pinnedPanels
      .filter((p: unknown): p is PinnedPanel => !!p && isHttpUrl((p as PinnedPanel).url))
      .map((p: PinnedPanel) => ({ label: String(p.label ?? p.url), url: String(p.url) }))
  } else if (typeof r.fleetAdminUrl === 'string' && isHttpUrl(r.fleetAdminUrl.trim())) {
    s.pinnedPanels = [{ label: 'Fleet', url: r.fleetAdminUrl.trim() }] // migrate legacy single-URL setting
  }
  if (typeof r.openrouterApiKey === 'string') s.openrouterApiKey = r.openrouterApiKey
  if (typeof r.openaiCompatApiKey === 'string') s.openaiCompatApiKey = r.openaiCompatApiKey
  if (typeof r.allowRepoExtensions === 'boolean') s.allowRepoExtensions = r.allowRepoExtensions
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
    if (typeof r.apps.formatOnSave === 'boolean') s.apps.formatOnSave = r.apps.formatOnSave
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
  if (r.notifications?.matrix && typeof r.notifications.matrix === 'object') {
    // Copy only well-formed channel → category → boolean entries; ignore junk
    // so a hand-edited file can never crash the dispatch.
    const clean: NotifyMatrix = {}
    for (const [ch, cats] of Object.entries(r.notifications.matrix as Record<string, unknown>)) {
      if (!NOTIFY_CHANNELS.includes(ch as never) || !cats || typeof cats !== 'object') continue
      const row: Record<string, boolean> = {}
      for (const [cat, val] of Object.entries(cats as Record<string, unknown>)) {
        if (NOTIFY_CATEGORIES.includes(cat as never) && typeof val === 'boolean') row[cat] = val
      }
      if (Object.keys(row).length) (clean as Record<string, unknown>)[ch] = row
    }
    s.notifications.matrix = clean
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

export const settingsFile = (): string => configPath('settings.json')

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
  for (const path of expandSecretPaths(out)) {
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

/** Drop the in-process cache. Tests only — the app reads settings for its life. */
export function resetSettingsCache(): void {
  cache = null
}

/**
 * Whether the settings file on disk exists but cannot be parsed.
 *
 * Kept separate from readSettings on purpose: reading has to keep working (the
 * app must still boot with defaults), but WRITING against a corrupt file would
 * persist those defaults over the user's real config and drop sealed secrets.
 */
function settingsCorrupt(): boolean {
  return readJsonState<unknown>(settingsFile(), () => null, {
    accept: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
  }).corrupt
}

export function readSettings(): Settings {
  if (cache) return cache
  try {
    cache = migrate(openSettingsFromDisk(JSON.parse(readFileSync(settingsFile(), 'utf8'))))
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
    slack,
    bridge,
    appearance,
    apps,
    engines,
    suggestions,
    noteFolders: patchNoteFolders,
    ...scalarPatch
  } = legacyPatch
  delete (scalarPatch as Record<string, unknown>)['open' + 'router']
  // Same fence as migrate(): a bad port would leave the bridge unable to bind —
  // an invalid patch keeps the current value instead of persisting it.
  const bridgePatch = { ...(bridge || {}) }
  if (bridgePatch.port !== undefined) {
    const port = Number(bridgePatch.port)
    if (!(Number.isInteger(port) && port >= 1024 && port <= 65535)) delete bridgePatch.port
  }
  return {
    ...cur,
    ...scalarPatch,
    telegram: { ...cur.telegram, ...(telegram || {}) },
    alerts: {
      desktop: { ...cur.alerts.desktop, ...(alerts?.desktop || {}) },
      webhooks: mergeWebhooks(cur.alerts.webhooks, alerts?.webhooks),
    },
    inbox: {
      ...cur.inbox,
      ...(inbox || {}),
      // A patch can arrive from a shell-built CLI call; never persist junk.
      destination: normalizeDestination(inbox?.destination ?? cur.inbox.destination),
    },
    slack: { ...cur.slack, ...(slack || {}) },
    bridge: { ...cur.bridge, ...bridgePatch },
    appearance: { ...cur.appearance, ...(appearance || {}) },
    apps: { ...cur.apps, ...(apps || {}) },
    engines: mergeEngineCfgs(cur.engines, engines),
    suggestions: { ...cur.suggestions, ...(suggestions || {}) },
    noteFolders: patchNoteFolders ? noteFolders(patchNoteFolders) : cur.noteFolders,
  }
}

/** Deep-merge a patch over current settings (telegram/engines merge per-key). */
export function patchSettings(patch: SettingsPatch): Settings {
  const file = settingsFile()
  const next = withFileLock(file, () => {
    // A corrupt settings.json means readSettings() handed us defaults. Merging a
    // patch onto those and saving would overwrite the user's real config —
    // including sealed secrets — with defaults plus one changed key. Move the
    // bad file aside and make the caller deal with it instead.
    if (settingsCorrupt()) {
      throw new Error(
        `settings.json is unreadable; moved aside to ${quarantineCorruptFile(file)} rather than overwriting it with defaults`,
      )
    }
    const merged = mergeSettingsPatch(readSettings(), patch)
    cache = merged
    // 0600: settings.json holds sealed secrets (and, when OS encryption is
    // available, nothing sensitive in cleartext) — but keep it owner-only
    // regardless so no other local user can read it. The atomic write only
    // applies mode on create, so chmod a pre-existing file too.
    writeFileAtomic(file, `${JSON.stringify(sealSettingsForDisk(merged), null, 2)}\n`, {
      mode: 0o600,
    })
    try {
      chmodSync(file, 0o600)
    } catch {
      /* best effort */
    }
    return merged
  })
  syncTelegramSidecar(next)
  syncSlackSidecar(next)
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
const telegramSidecarFile = (): string => configPath('telegram.local.json')

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
  const file = telegramSidecarFile()
  try {
    const creds = telegramSidecarPayload(s)
    if (creds) {
      writeFileAtomic(file, JSON.stringify(creds), { mode: 0o600 })
      // The atomic write only applies mode on create; force-tighten a pre-existing file.
      try {
        chmodSync(file, 0o600)
      } catch {
        /* best effort */
      }
    } else if (existsSync(file)) {
      unlinkSync(file)
    }
  } catch {
    /* best effort — telegram is a non-critical side channel */
  }
}

// --- slack sidecar (out-of-process delivery) ---------------------------------
//
// Same shape as the telegram sidecar and for the same reason: the bin filers
// can't call safeStorage to decrypt the sealed bot token, so the app mirrors
// the decrypted token — plus the non-secret channel config they need to route
// with — to a 0600 sidecar. One file, so the read side is one JSON.parse.
const slackSidecarFile = (): string => configPath('slack.local.json')

export type SlackSidecar = SlackCfg & { destination: InboxDestination }

/** The config worth mirroring (token present + a destination that posts), or
 *  null to clear. Removing the sidecar when Slack is off keeps a revoked or
 *  stale token from lingering on disk. */
export function slackSidecarPayload(s: Settings): SlackSidecar | null {
  if (!s.slack.botToken || s.inbox.destination === 'inbox') return null
  return { ...s.slack, destination: s.inbox.destination }
}

/** Mirror decrypted slack config to the 0600 sidecar, or remove it when off. */
export function syncSlackSidecar(s: Settings = readSettings()): void {
  const file = slackSidecarFile()
  try {
    const payload = slackSidecarPayload(s)
    if (payload) {
      writeFileAtomic(file, JSON.stringify(payload), { mode: 0o600 })
      try {
        chmodSync(file, 0o600)
      } catch {
        /* best effort */
      }
    } else if (existsSync(file)) {
      unlinkSync(file)
    }
  } catch {
    /* best effort — slack is a non-critical side channel */
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
  // Settings override always wins.
  const p = readSettings().engines[engine]?.path
  if (p) return p
  const d = engineOf(engine)
  if (!d) return engine
  // Then an env override (GT_CLAUDE_BIN / GT_CURSOR_BIN), declared per engine.
  if (d.bin.envVar && process.env[d.bin.envVar]) return process.env[d.bin.envVar] as string
  // Then declared install locations, for binaries that aren't on a login
  // shell's PATH (or-agent for the OpenRouter/self-hosted harness; opencode,
  // which installs to ~/.opencode/bin). `~` is expanded here — the registry
  // stays filesystem-free.
  for (const cand of d.bin.candidates || []) {
    const abs = cand.startsWith('~/') ? join(homedir(), cand.slice(2)) : cand
    if (existsSync(abs)) return abs
  }
  // Else the declared binary name, resolved on PATH.
  return d.bin.name
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

/** Per-engine reasoning-effort fallback ('' = let the engine pick). Stored raw;
 *  launch sites validate against the registry level set via coerceEffort. */
export function engineDefaultEffort(engine: EngineId): string {
  return readSettings().engines[engine]?.defaultEffort || ''
}

export function resolveEngineEffort(engine: EngineId, effort?: string, daemon?: DaemonCfg): string {
  const explicit = effort?.trim()
  if (explicit) return explicit
  return daemon ? daemon.engines[engine]?.defaultEffort || '' : engineDefaultEffort(engine)
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
