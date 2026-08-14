import type { EngineId } from '../engines'
import type { InboxDestination } from '../slack'
import type { NotifyCategory, NotifyMatrix } from '../notifications'
import type { ExperimentsCfg } from '../experiments'

export type EngineCfg = {
  path: string // '' = use the bare binary name on PATH
  defaultModel: string // '' = let the engine pick its own default
  defaultEffort: string // '' = engine default; validated against the registry level set
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

/** One entry of the spawn prompt library — a named block of text the New
 *  session screen prefills into a new session's input. It lives in settings so
 *  it is exportable and shared across repos; the last-used *selection* is a
 *  per-machine renderer pref instead. */
export type SavedPrompt = { id: string; name: string; text: string }

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
  remoteHosts: RemoteHost[]
  harnessDir: string // optional cross-repo review-artifact store
  // Max agent runs loaded into memory at startup (the Runs-tab working set). Run
  // logs on disk are NEVER auto-deleted (storage is cheap — prune manually); this
  // only bounds RAM so a huge archive doesn't bloat the process. 0 = load all.
  runMemoryCap: number
  templateRepo: string // scaffold source
  pinnedPanels: PinnedPanel[] // web dashboards pinned as the Panels tab; [] → tab hidden (personal)
  /** Named prompts offered by the New session screen's spawn options; [] → the
   *  built-in prompt and the saved agents are still offered, just no customs. */
  savedPrompts: SavedPrompt[]
  openrouterApiKey: string // sealed; injected as OPENROUTER_API_KEY for OpenRouter (or-agent) runs. '' → fall back to process env
  openaiCompatApiKey: string // sealed; injected as OPENAI_API_KEY for openai-compat (or-agent) runs. '' → fall back to process env
  /** Allow repo-provided executable surfaces (.TerMinal/widgets.json +
   *  tabs.json). OFF by default: even with the per-repo trust/approval flow, a
   *  cloned repo getting command execution + in-app embeds is a real risk, so
   *  the surfaces don't exist at all unless the operator opts in globally. */
  allowRepoExtensions: boolean
  /** Experimental features, off until opted in (src/shared/experiments.ts).
   *  Absent flags read as off, so a pre-flag settings file stays dark. */
  experiments: ExperimentsCfg
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
    | 'experiments'
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
  /** Per-flag; merges over the saved block so one toggle never clears another. */
  experiments?: ExperimentsCfg
}

/**
 * Result of `settings:validate-projects-dir`, for a LOCAL or a REMOTE dir.
 *
 * The remote half answers over SSH and cannot count repos or resolve a parent
 * cheaply, so it omits `repoCount`/`suggestedParent` and can answer with a bare
 * `'error'`. The local-only shape this type used to describe admitted none of
 * that — while the UI guarded `typeof repoCount === 'number'` all along.
 */
export type ProjectsDirValidation =
  | { ok: true; dir: string; repoCount?: number }
  | {
      ok: false
      reason: 'is-repo' | 'error'
      dir: string
      suggestedParent?: string
      message: string
    }
  | {
      ok: false
      reason: 'no-repos-found'
      dir: string
      suggestedChild?: string
      suggestedCount?: number
      message: string
    }

/** User overrides on the notification matrix; {} means "all shipped defaults". */
export type NotificationsCfg = { matrix: NotifyMatrix }
