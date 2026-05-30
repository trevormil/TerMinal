import { useEffect, useState, type ReactNode } from 'react'
import {
  X,
  FolderOpen,
  Loader2,
  Send,
  CircleCheck,
  CircleSlash,
  RotateCcw,
  TerminalSquare,
  ClipboardCopy,
} from 'lucide-react'
import type { Settings, SettingsPatch, EnvDetect, Engine, ForgePref } from '../lib/types'

const inp =
  'w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="border-b border-[var(--gt-border)]/60 px-5 py-4">
      <div className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">{title}</div>
      {desc && <div className="mb-3 text-[11px] leading-relaxed text-zinc-600">{desc}</div>}
      {!desc && <div className="mb-3" />}
      {children}
    </div>
  )
}

function Toggle({ on, onToggle, label, hint }: { on: boolean; onToggle: () => void; label: string; hint?: string }) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left hover:border-[var(--gt-accent)]/40"
    >
      <span className="min-w-0">
        <span className="text-[12px] text-zinc-200">{label}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] text-zinc-600">{hint}</span>}
      </span>
      <span
        className={`relative ml-3 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          on ? 'bg-[var(--gt-accent)]' : 'bg-zinc-700'
        }`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  )
}

function Readiness({ ok, name, hint }: { ok: boolean; name: string; hint: string }) {
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

export function SettingsPanel({ onClose, onRerunSetup }: { onClose: () => void; onRerunSetup: () => void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [env, setEnv] = useState<EnvDetect | null>(null)
  const [tg, setTg] = useState<{ busy?: boolean; ok?: boolean; error?: string } | null>(null)
  const [notify, setNotify] = useState<{ busy?: boolean; ok?: boolean; path?: string; error?: string } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.gt.settings.get().then(setS)
    window.gt.detectEnv().then(setEnv)
  }, [])

  const save = async (patch: SettingsPatch) => setS(await window.gt.settings.patch(patch))
  const appOptions = (detected: string[] | undefined, fallback: string[], current: string) => {
    const list = [...new Set([...(detected?.length ? detected : fallback), ...(current ? [current] : [])])]
    return list.map((a) => (
      <option key={a} value={a} className="bg-[var(--gt-panel)]">
        {a}
      </option>
    ))
  }
  const browse = async (key: 'projectsDir') => {
    const d = await window.gt.pickDir()
    if (d) save({ [key]: d })
  }
  const testTelegram = async () => {
    setTg({ busy: true })
    setTg(await window.gt.telegram.test())
  }
  const installNotify = async () => {
    setNotify({ busy: true })
    setNotify(await window.gt.installGtNotify())
  }
  const copySetupPrompt = async () => {
    const repo = s?.templateRepo || 'https://github.com/trevormil/project-template'
    const prompt = [
      'I just installed TerMinal (an Electron alt-terminal for AI coding agents).',
      'Help me finish one-time setup on this machine. Check what already exists before changing anything.',
      '',
      '1. CLIs: ensure `claude` (required) is installed + logged in, plus any of `codex`, `gh`, `glab` I plan to use. Walk me through `gh auth login` / `glab auth login` if needed.',
      `2. Global agent skills: clone ${repo} and follow its setup docs to install the project-template workflow skills (code-review, iterate, test-suite, document, pr-creation, stacked-mr, notify) into ~/.claude/skills (and ~/.codex/skills for codex). Verify each resolves.`,
      '3. (Optional) Telegram: help me create a bot with @BotFather and find my numeric chat id, so I can paste the token + id into TerMinal → Settings → Telegram.',
      '',
      'Summarize what you did and what is left for me.',
    ].join('\n')
    await window.gt.clipboardWrite(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  if (!s)
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
        <Loader2 className="animate-spin text-zinc-500" />
      </div>
    )

  const MODEL_OPTIONS: Record<Engine, string[]> = {
    claude: ['', 'haiku', 'sonnet', 'opus'],
    codex: ['', 'gpt-5', 'gpt-5-codex', 'o4-mini'],
  }
  const engineRow = (e: Engine, vendor: string) => {
    const found = env ? (e === 'codex' ? env.codex.found : env.claude.found) : true
    const detPath = env ? (e === 'codex' ? env.codex.path : env.claude.path) : ''
    const defModel = s.engines[e].defaultModel
    return (
      <div key={e} className="mb-2">
        <div className="mb-1 flex items-center gap-2">
          <Readiness ok={found} name={e} hint={found ? detPath || vendor : `not on PATH — set a path below`} />
        </div>
        <input
          defaultValue={s.engines[e].path}
          onBlur={(ev) => ev.target.value !== s.engines[e].path && save({ engines: { [e]: { path: ev.target.value.trim() } } })}
          placeholder={`${e} (bare name on PATH, or absolute path)`}
          spellCheck={false}
          className={`${inp} font-mono`}
        />
        <div className="mt-1 flex items-center gap-2">
          <label className="text-[10.5px] text-zinc-500">default model</label>
          <select
            value={defModel}
            onChange={(ev) =>
              save({ engines: { [e]: { defaultModel: ev.target.value } } })
            }
            className="rounded-md border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none"
          >
            {MODEL_OPTIONS[e].map((m) => (
              <option key={m} value={m}>
                {m || '(engine default)'}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-zinc-600">
            applied to every {e} run unless the agent/schedule overrides
          </span>
        </div>
      </div>
    )
  }

  const forgeOpt = (val: ForgePref, label: string, hint: string) => (
    <button
      key={val}
      onClick={() => save({ forge: val })}
      className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
        s.forge === val
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
          : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/50'
      }`}
    >
      <div className="text-[12px] font-semibold">{label}</div>
      <div className="text-[10.5px] text-zinc-500">{hint}</div>
    </button>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-[86vh] w-[580px] flex-col overflow-hidden rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-5 py-3">
          <h2 className="flex-1 text-[13px] font-bold text-zinc-100">Settings</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Projects & worktrees */}
          <Section title="Projects & worktrees" desc="Where the entry screen looks for repos, and where agent worktrees are created.">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  defaultValue={s.projectsDir}
                  onBlur={(e) => e.target.value !== s.projectsDir && save({ projectsDir: e.target.value.trim() })}
                  placeholder="~ (home) — leave blank to auto-detect"
                  spellCheck={false}
                  className={`${inp} font-mono`}
                />
                <button onClick={() => browse('projectsDir')} className={`${inp} flex w-auto shrink-0 items-center gap-1.5 hover:border-[var(--gt-accent)]/60`}>
                  <FolderOpen size={13} strokeWidth={2} />
                  Browse
                </button>
              </div>
              <input
                defaultValue={s.worktreesDir}
                onBlur={(e) => e.target.value !== s.worktreesDir && save({ worktreesDir: e.target.value.trim() })}
                placeholder={`${tilde(s.projectsDir) || '<projects>'}/.worktrees (default)`}
                spellCheck={false}
                className={`${inp} font-mono`}
              />
              <input
                defaultValue={s.templateRepo}
                onBlur={(e) => e.target.value !== s.templateRepo && save({ templateRepo: e.target.value.trim() })}
                placeholder="scaffold template repo (default: trevormil/project-template)"
                spellCheck={false}
                className={`${inp} font-mono`}
              />
            </div>
          </Section>

          {/* Engines */}
          <Section title="Engines" desc="The agent backends. Detected on your PATH; override the binary path if needed.">
            {engineRow('codex', 'OpenAI Codex')}
            {engineRow('claude', 'Anthropic Claude')}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">Default:</span>
              {(['codex', 'claude'] as Engine[]).map((e) => (
                <button
                  key={e}
                  onClick={() => save({ defaultEngine: e })}
                  className={`rounded-md border px-2.5 py-1 text-[11px] ${
                    s.defaultEngine === e
                      ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                      : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </Section>

          {/* Forge */}
          <Section title="Code forge" desc="Auto picks gh for GitHub remotes and glab otherwise — per repo.">
            <div className="flex gap-2">
              {forgeOpt('auto', 'Auto', 'detect per repo')}
              {forgeOpt('github', 'GitHub', 'force gh / PRs')}
              {forgeOpt('gitlab', 'GitLab', 'force glab / MRs')}
            </div>
            {env && (
              <div className="mt-3 space-y-1">
                <Readiness ok={env.gh.found && env.gh.authed} name="gh" hint={env.gh.found ? (env.gh.authed ? `authenticated${env.gh.authHost ? ` (${env.gh.authHost})` : ''}` : 'installed — run `gh auth login`') : 'not installed — `brew install gh`'} />
                <Readiness ok={env.glab.found && env.glab.authed} name="glab" hint={env.glab.found ? (env.glab.authed ? `authenticated${env.glab.authHost ? ` (${env.glab.authHost})` : ''}` : 'installed — run `glab auth login`') : 'not installed — `brew install glab`'} />
              </div>
            )}
          </Section>

          {/* External apps */}
          <Section
            title="External apps"
            desc="Which app the Files tab's 'Open in editor' and the Browser tab's 'Open in browser' hand off to. Runs `open -a <app>` (works for any installed macOS app)."
          >
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-[12px] text-zinc-400">
                Editor
                <select
                  value={s.apps.editor || 'Cursor'}
                  onChange={(e) => save({ apps: { editor: e.target.value } })}
                  className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
                >
                  {appOptions(env?.apps.editors, ['Cursor', 'Visual Studio Code'], s.apps.editor)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-[12px] text-zinc-400">
                Browser
                <select
                  value={s.apps.browser || 'Brave Browser'}
                  onChange={(e) => save({ apps: { browser: e.target.value } })}
                  className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
                >
                  {appOptions(env?.apps.browsers, ['Brave Browser'], s.apps.browser)}
                </select>
              </label>
            </div>
          </Section>

          {/* Telegram */}
          <Section title="Telegram (notifications + AFK control)" desc="Create a bot with @BotFather, paste its token and your chat id. Leave blank to use the legacy ~/.claude scripts if present.">
            <div className="space-y-2">
              <Toggle on={s.telegram.notify} onToggle={() => save({ telegram: { notify: !s.telegram.notify } })} label="Mirror notifications to Telegram" />
              <Toggle on={s.telegram.control} onToggle={() => save({ telegram: { control: !s.telegram.control } })} label="Remote control (AFK)" hint="Launch/cancel agents by texting the bot" />
              <input
                defaultValue={s.telegram.botToken}
                onBlur={(e) => e.target.value !== s.telegram.botToken && save({ telegram: { botToken: e.target.value.trim() } })}
                placeholder="bot token (123456:ABC-DEF…)"
                spellCheck={false}
                className={`${inp} font-mono`}
              />
              <div className="flex items-center gap-2">
                <input
                  defaultValue={s.telegram.chatId}
                  onBlur={(e) => e.target.value !== s.telegram.chatId && save({ telegram: { chatId: e.target.value.trim() } })}
                  placeholder="chat id (your numeric id)"
                  spellCheck={false}
                  className={`${inp} font-mono`}
                />
                <button onClick={testTelegram} disabled={tg?.busy} className={`${inp} flex w-auto shrink-0 items-center gap-1.5 hover:border-[var(--gt-accent)]/60 disabled:opacity-50`}>
                  {tg?.busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} strokeWidth={2} />}
                  Test
                </button>
              </div>
              {tg && !tg.busy && (
                <div className={`text-[11px] ${tg.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
                  {tg.ok ? '✓ Sent — check your chat.' : tg.error}
                </div>
              )}
            </div>
          </Section>

          {/* Setup / integrations */}
          <Section title="Setup & integrations" desc="One-time helpers for a fresh machine. Agents inherit your global ~/.claude and ~/.codex config + skills.">
            <div className="space-y-2">
              <button onClick={copySetupPrompt} className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40">
                {copied ? <CircleCheck size={14} strokeWidth={2} className="text-[var(--gt-green)]" /> : <ClipboardCopy size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />}
                Copy global-skills setup prompt
                <span className="ml-auto text-[10.5px] text-zinc-600">{copied ? 'copied — paste into Claude' : 'paste into Claude'}</span>
              </button>
              <button onClick={installNotify} disabled={notify?.busy} className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40 disabled:opacity-50">
                {notify?.busy ? <Loader2 size={14} className="animate-spin" /> : <TerminalSquare size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />}
                Install <span className="font-mono">gt-notify</span> to ~/.local/bin
                <span className="ml-auto text-[10.5px] text-zinc-600">activity feed hook</span>
              </button>
              {notify && !notify.busy && (
                <div className={`text-[11px] ${notify.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}>
                  {notify.ok ? `✓ Installed at ${tilde(notify.path || '')}` : notify.error}
                </div>
              )}
              <button onClick={onRerunSetup} className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-left text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/40">
                <RotateCcw size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
                Re-run first-time setup
              </button>
            </div>
          </Section>

          <div className="px-5 py-3 text-center text-[10.5px] text-zinc-600">
            TerMinal · settings stored in ~/.config/TerMinal/settings.json
          </div>
        </div>
      </div>
    </div>
  )
}
