import { createContext, useContext, type ReactNode } from 'react'
import { CircleCheck, CircleSlash, Loader2, Plus, Send, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  AlertChannelId,
  DaemonCfg,
  Engine,
  EnvDetect,
  RemoteHost,
  RemoteSettingsProbe,
  Settings,
  SettingsPatch,
  WebhookCfg,
} from '../../lib/types'
import { ENGINE_IDS } from '../../lib/engines'
import {
  CATEGORY_META,
  NOTIFY_CATEGORIES,
  webhookWants,
  type NotifyMatrix,
} from '../../../../shared/notifications'

export const inp =
  'w-full rounded-md border border-[var(--gt-border)] bg-black/35 px-2.5 py-1.5 text-[12px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-700 focus:border-[var(--gt-accent)]/60 focus:bg-black/45'

export const buttonSoft =
  'inline-flex items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-zinc-100'
export const actionButton =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/25 px-3 text-[12px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50'

export const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}
export const emptyDaemon = (): DaemonCfg => ({
  projectsDir: '',
  worktreesDir: '',
  harnessDir: '',
  templateRepo: '',
  // Derived from the registry — this was the third hand-written copy of the
  // per-engine defaults (main had two more).
  engines: Object.fromEntries(
    ENGINE_IDS.map((id) => [id, { path: '', defaultModel: '', defaultEffort: '', baseUrl: '' }]),
  ) as DaemonCfg['engines'],
  defaultEngine: 'claude',
  forge: 'auto',
})
export const daemonFromSettings = (s: Settings): DaemonCfg => ({
  projectsDir: s.projectsDir,
  worktreesDir: s.worktreesDir,
  harnessDir: s.harnessDir,
  templateRepo: s.templateRepo,
  engines: s.engines,
  defaultEngine: s.defaultEngine,
  forge: s.forge,
})
export const mergeDaemon = (
  base: DaemonCfg,
  patch: Partial<Omit<DaemonCfg, 'engines'>> & {
    engines?: Partial<Record<Engine, Partial<DaemonCfg['engines'][Engine]>>>
  },
): DaemonCfg => ({
  ...base,
  ...patch,
  engines: Object.fromEntries(
    ENGINE_IDS.map((id) => [id, { ...base.engines[id], ...(patch.engines?.[id] || {}) }]),
  ) as DaemonCfg['engines'],
})

// Which category the content pane is showing. Sections read it themselves so
// the many call sites stay untouched. Also readable directly (via
// useContext) by any section that needs to know it's the active one — e.g.
// to lazily kick off an expensive fetch only when opened.
export const ActiveSectionContext = createContext('')

/**
 * One settings category. Only the selected one renders — the panel used to
 * stack all twenty in a single scroll, which buried whatever you opened it for.
 *
 * Since it is now the only thing in the pane, the card chrome is gone: the
 * sidebar already says which category you are in, so a bordered card and an
 * icon tile repeating that name were pure noise. The description stays — it is
 * the one part that says something the sidebar label doesn't.
 */
export function Section({
  id,
  icon: Icon,
  title,
  desc,
  actions,
  children,
}: {
  id: string
  icon: LucideIcon
  title: string
  desc?: string
  actions?: ReactNode
  children: ReactNode
}) {
  if (useContext(ActiveSectionContext) !== id) return null
  return (
    <section id={id}>
      <div className="mb-4 flex items-start gap-2.5 border-b border-[var(--gt-border)] pb-3">
        <Icon size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-zinc-100">{title}</div>
          {desc && (
            <div className="mt-0.5 max-w-[68ch] text-[11px] leading-relaxed text-zinc-500">
              {desc}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function Toggle({
  on,
  onToggle,
  label,
  hint,
}: {
  on: boolean
  onToggle: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-md border border-[var(--gt-border)] bg-black/25 px-2.5 py-2 text-left transition-colors hover:border-[var(--gt-accent)]/40"
    >
      <span className="min-w-0">
        <span className="text-[12px] text-zinc-200">{label}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] text-zinc-600">{hint}</span>}
      </span>
      <span
        className={`relative ml-3 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          on ? 'bg-[var(--gt-accent)]' : 'bg-white/10'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  )
}

export function Readiness({ ok, name, hint }: { ok: boolean; name: string; hint: string }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      {ok ? (
        <CircleCheck size={14} strokeWidth={2} className="shrink-0 text-[var(--gt-green)]" />
      ) : (
        <CircleSlash size={14} strokeWidth={2} className="shrink-0 text-zinc-600" />
      )}
      <span className="font-mono text-zinc-300">{name}</span>
      <span className="truncate text-zinc-600">{hint}</span>
    </div>
  )
}

// A collapsed-by-default manual editor. Shared between Paths (raw path
// fields) and Engines (override binary path) — both want the same
// "don't show a raw text box unless asked" affordance.
export function EditDetails({
  children,
  label = 'Edit manually',
}: {
  children: ReactNode
  label?: string
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-[10.5px] text-zinc-600 transition-colors hover:text-zinc-400">
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Hide editor</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}

// Write-only input for a credential. `settings:get` returns masks, not values
// (src/main/settings-mask.ts), so binding one to `defaultValue` would put
// '••••••••' in the box as EDITABLE text: click in, type, and you save
// '••••••••ghi' — which isn't the mask, so nothing strips it and the real
// credential is overwritten with garbage. The field therefore always starts
// EMPTY and only ever writes what you actually type.
//
// `set` comes from settings.secretsSet; blur with an empty box is a no-op (so
// tabbing through can't wipe a stored secret), and Clear is the explicit way to
// remove one.
export function SecretInput({
  set,
  onSave,
  placeholder,
  mono = true,
}: {
  set: boolean
  onSave: (value: string) => void
  placeholder: string
  mono?: boolean
}) {
  return (
    <div className="space-y-1">
      <input
        type="password"
        defaultValue=""
        onBlur={(e) => {
          const value = e.target.value.trim()
          if (!value) return
          onSave(value)
          e.target.value = '' // never leave a credential sitting in the DOM
        }}
        placeholder={set ? '•••••••• (set — type to replace)' : placeholder}
        spellCheck={false}
        autoComplete="off"
        className={`${inp} ${mono ? 'font-mono' : ''}`}
      />
      {set && (
        <button
          onClick={() => onSave('')}
          className="text-[10.5px] text-zinc-600 underline-offset-2 hover:text-amber-400 hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  )
}

// Any number of outbound webhook destinations. They exist as a LIST rather than
// one URL because a Slack channel, a Discord channel and a homegrown endpoint
// rarely want the same traffic — hence the per-destination category chips,
// which override the `webhook` row of the notification matrix below.
//
// Every edit saves the WHOLE list (main replaces it wholesale so deletes stick,
// and restores each entry's saved URL when the patch omits it — the renderer
// only ever holds a mask).
export function WebhookList({
  webhooks,
  secretsSet,
  matrix,
  save,
  test,
  results,
}: {
  webhooks: WebhookCfg[]
  secretsSet?: Record<string, boolean>
  matrix: NotifyMatrix
  save: (webhooks: (Partial<WebhookCfg> & { id: string })[]) => void
  test: (channel: AlertChannelId, webhookId?: string) => void
  results: Record<string, { busy?: boolean; ok?: boolean; error?: string } | undefined>
}) {
  // Patches drop `url` for every untouched entry, so main restores it by id.
  const stripped = () => webhooks.map(({ url: _url, ...rest }) => rest)
  const patch = (id: string, fields: Partial<WebhookCfg>) =>
    save(stripped().map((w) => (w.id === id ? { ...w, ...fields } : w)))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-zinc-200">Outbound webhooks</div>
          <div className="text-[10.5px] text-zinc-600">
            POST each alert as JSON — paste a Slack or Discord incoming-webhook URL, or your own
            endpoint.
          </div>
        </div>
        <button
          onClick={() =>
            save([
              ...stripped(),
              { id: crypto.randomUUID(), name: 'Webhook', url: '', enabled: false },
            ])
          }
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--gt-border)] bg-black/25 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
        >
          <Plus size={12} strokeWidth={2.25} />
          Add
        </button>
      </div>

      {webhooks.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--gt-border)] px-3 py-2 text-[11px] text-zinc-600">
          No webhooks configured.
        </div>
      ) : (
        webhooks.map((w) => {
          const result = results[`webhook:${w.id}`]
          return (
            <div
              key={w.id}
              className="space-y-2 rounded-md border border-[var(--gt-border)] bg-black/20 p-2.5"
            >
              <div className="flex items-center gap-2">
                {/* A compact switch, not <Toggle> — that one is a full-width
                    labelled row and would swallow the rest of this line. */}
                <button
                  onClick={() => patch(w.id, { enabled: !w.enabled })}
                  title={w.enabled ? 'Disable this webhook' : 'Enable this webhook'}
                  aria-pressed={w.enabled}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    w.enabled ? 'bg-[var(--gt-accent)]' : 'bg-white/10'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      w.enabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
                <input
                  defaultValue={w.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim() || 'Webhook'
                    if (name !== w.name) patch(w.id, { name })
                  }}
                  placeholder="Name"
                  className={`${inp} h-8 flex-1`}
                />
                <button
                  onClick={() => test('webhook', w.id)}
                  disabled={result?.busy}
                  title="Send a test alert to this endpoint"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--gt-border)] bg-black/25 px-2.5 text-[11.5px] text-zinc-200 transition-colors hover:border-[var(--gt-accent)]/60 disabled:opacity-50"
                >
                  {result?.busy ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Send size={12} strokeWidth={2} />
                  )}
                  Test
                </button>
                <button
                  onClick={() => save(stripped().filter((x) => x.id !== w.id))}
                  title="Remove this webhook"
                  className="shrink-0 rounded-md p-1.5 text-zinc-600 transition-colors hover:text-amber-400"
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>

              <SecretInput
                set={!!secretsSet?.[`alerts.webhooks.${webhooks.indexOf(w)}.url`]}
                onSave={(url) => patch(w.id, { url })}
                placeholder="https://hooks.slack.com/services/…"
              />

              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  Sends
                </span>
                {NOTIFY_CATEGORIES.map((cat) => {
                  const on = webhookWants(cat, w.categories, matrix)
                  return (
                    <button
                      key={cat}
                      title={CATEGORY_META[cat].desc}
                      onClick={() =>
                        patch(w.id, { categories: { ...(w.categories || {}), [cat]: !on } })
                      }
                      className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                        on
                          ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/20 text-zinc-100'
                          : 'border-[var(--gt-border)] text-zinc-600 hover:text-zinc-400'
                      }`}
                    >
                      {CATEGORY_META[cat].label}
                    </button>
                  )
                })}
              </div>

              {result && !result.busy && (
                <div
                  className={`text-[11px] ${result.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}
                >
                  {result.ok ? '✓ Sent — check the receiver.' : result.error}
                </div>
              )}
            </div>
          )
        })
      )}

      <div className="text-[10.5px] text-zinc-600">
        Payload: {'{'} source, kind (done|blocked|question|info), title, detail, refs, ts, text,
        content {'}'} — <span className="font-mono">text</span> renders in Slack,{' '}
        <span className="font-mono">content</span> in Discord.
      </div>
    </div>
  )
}

// The shared props bag every section reads from. Owned by SettingsPanel
// (state has to live somewhere, and switching daemon profile / saving
// settings has to be visible to every section at once); section-local state
// (a panel's own busy flags, drafts, etc.) stays inside that section's file
// instead of growing this type.
export type SettingsCtx = {
  s: Settings
  env: EnvDetect | null
  save: (patch: SettingsPatch) => Promise<void>
  profile: string
  setProfile: (id: string) => void
  selectedHost: RemoteHost | null
  selectedDaemon: DaemonCfg
  selectedProbe: RemoteSettingsProbe | { loading: true } | null
  selectedIsRemote: boolean
  saveDaemon: (
    patch: Partial<Omit<DaemonCfg, 'engines'>> & {
      engines?: Partial<Record<Engine, Partial<DaemonCfg['engines'][Engine]>>>
    },
  ) => Promise<void>
  refreshRemoteProbe: (host: RemoteHost) => void
  onRerunSetup: () => void
}

/** One settings category, discovered the same way tabs/registry.ts discovers tabs. */
export type SettingsSectionSpec = {
  id: string
  /** Short label shown in the nav rail and the header breadcrumb. */
  title: string
  icon: LucideIcon
  order: number
  Component: (props: { ctx: SettingsCtx }) => ReactNode
}
