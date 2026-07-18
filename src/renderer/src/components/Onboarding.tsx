import { useEffect, useState } from 'react'
import {
  FolderOpen,
  CircleCheck,
  CircleSlash,
  ArrowLeft,
  ArrowRight,
  Loader2,
  RefreshCw,
  Send,
  TerminalSquare,
} from 'lucide-react'
import type { Engine, EnvDetect, ProjectsDirValidation } from '../lib/types'
import { buildOnboardingPatch } from '../lib/onboarding'
import logo from '../assets/logo.png'

// First-run welcome, two steps. Step 1 (environment): PATH probe, projects
// dir, explicit default-engine pick. Step 2 (connections): Telegram, MCP
// server, gt-notify, OpenRouter key — ALL optional. Every field has a working
// default, so skipping at any point is safe; half-filled connections are
// dropped, not saved broken (see buildOnboardingPatch).

function Row({ ok, name, hint }: { ok: boolean; name: string; hint: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      {ok ? (
        <CircleCheck size={15} strokeWidth={2} className="shrink-0 text-[var(--gt-green)]" />
      ) : (
        <CircleSlash size={15} strokeWidth={2} className="shrink-0 text-zinc-600" />
      )}
      <span className="w-14 font-mono text-zinc-200">{name}</span>
      <span className="truncate text-zinc-500">{hint}</span>
    </div>
  )
}

const card = 'mb-5 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4'
const cardTitle = 'mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400'
const fieldLabel = 'text-[10px] font-semibold uppercase tracking-wider text-zinc-600'
const fieldInput =
  'w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 font-mono text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'
const softButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/60 disabled:opacity-50'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const [env, setEnv] = useState<EnvDetect | null>(null)
  const [projectsDir, setProjectsDir] = useState('')
  const [projectsDirValidation, setProjectsDirValidation] = useState<ProjectsDirValidation | null>(
    null,
  )
  // '' until the probe lands, then defaults to the preferred detected engine.
  // The user can still override — including to an engine that wasn't found.
  const [defaultEngine, setDefaultEngine] = useState<Engine | ''>('')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [tgNotify, setTgNotify] = useState(true)
  const [tg, setTg] = useState<{ busy?: boolean; ok?: boolean; error?: string } | null>(null)
  const [orKey, setOrKey] = useState('')
  const [mcp, setMcp] = useState<{
    busy?: boolean
    ok?: boolean
    installed?: string[]
    error?: string
  } | null>(null)
  const [notify, setNotify] = useState<{
    busy?: boolean
    ok?: boolean
    path?: string
    error?: string
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [rechecking, setRechecking] = useState(false)

  // Re-probe PATH without restarting — after the user installs a missing engine
  // in another terminal, they can refresh the readiness rows in place.
  const recheck = async () => {
    setRechecking(true)
    try {
      setEnv(await window.gt.detectEnv())
    } finally {
      setRechecking(false)
    }
  }

  useEffect(() => {
    window.gt.detectEnv().then(setEnv)
    window.gt.settings.get().then(async (s) => {
      if (s.projectsDir) {
        setProjectsDir(s.projectsDir)
        return
      }
      // No saved value: pre-fill the densest detected root (e.g. ~/workspace)
      // instead of leaving blank → home, which silently discovers zero repos
      // for nested layouts. Falls back to blank (home) when nothing is denser.
      const suggestion = await window.gt.settings.suggestProjectsDir().catch(() => null)
      setProjectsDir(suggestion?.dir ?? '')
    })
  }, [])

  // Seed the engine pick from detection (codex preferred, then claude, then
  // cursor — an absent default engine makes scheduled runs silently no-op).
  useEffect(() => {
    if (!env) return
    setDefaultEngine((cur) => {
      if (cur) return cur
      return env.codex.found
        ? 'codex'
        : env.claude.found
          ? 'claude'
          : env.cursor.found
            ? 'cursor'
            : ''
    })
  }, [env])

  const browse = async () => {
    const d = await window.gt.pickDir()
    if (d) setProjectsDir(d)
  }
  useEffect(() => {
    let alive = true
    window.gt.settings.validateProjectsDir({ dir: projectsDir }).then((v) => {
      if (alive) setProjectsDirValidation(v)
    })
    return () => {
      alive = false
    }
  }, [projectsDir])

  // "Skip for now" (step 1) applies nothing; "Skip connections" applies step 1
  // only; "Finish" applies everything filled in. All paths mark onboarded.
  const finish = async (applySetup: boolean, applyConnections: boolean) => {
    setBusy(true)
    await window.gt.settings.patch(
      buildOnboardingPatch({
        applySetup,
        projectsDir,
        defaultEngine,
        applyConnections,
        telegramBotToken: botToken,
        telegramChatId: chatId,
        telegramNotify: tgNotify,
        openrouterApiKey: orKey,
      }),
    )
    onDone()
  }

  // The test IPC reads saved settings, so persist the draft token/chat id
  // first. Harmless if the user later skips — notify stays off until Finish.
  const testTelegram = async () => {
    setTg({ busy: true })
    await window.gt.settings.patch({
      telegram: { botToken: botToken.trim(), chatId: chatId.trim() },
    })
    setTg(await window.gt.telegram.test())
  }
  const installMcp = async () => {
    setMcp({ busy: true })
    const r = await window.gt.mcpInstall()
    if ('error' in r) setMcp({ error: r.error })
    else setMcp({ ok: true, installed: r.installed })
  }
  const installNotify = async () => {
    setNotify({ busy: true })
    setNotify(await window.gt.installGtNotify())
  }

  const eng = env && (env.codex.found || env.claude.found || env.cursor.found)
  const engineFound = (e: Engine) =>
    e === 'codex' ? !!env?.codex.found : e === 'claude' ? !!env?.claude.found : !!env?.cursor.found

  const stepDot = (n: 1 | 2) => (
    <span
      className={`h-1.5 rounded-full transition-all ${
        step === n ? 'w-5 bg-[var(--gt-accent)]' : 'w-1.5 bg-zinc-700'
      }`}
    />
  )

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--gt-bg)]">
      <div className="mx-auto max-w-xl px-8 py-12">
        <div className="mb-2 flex items-center gap-3">
          <img src={logo} alt="" draggable={false} className="h-10 w-10 rounded-xl" />
          <h1 className="gt-grad-text text-2xl font-bold tracking-tight">
            {step === 1 ? 'Welcome to TerMinal' : 'Connections'}
          </h1>
          <div className="ml-auto flex items-center gap-1.5">
            {stepDot(1)}
            {stepDot(2)}
          </div>
        </div>
        <p className="mb-7 text-sm text-zinc-500">
          {step === 1
            ? 'Mission control for AI coding agents. Quick one-time setup — everything has a sensible default, and you can change it all later in Settings.'
            : 'All optional — wire these once and agents can reach you anywhere. Skip freely; everything lives in Settings too.'}
        </p>

        {step === 1 ? (
          <>
            {/* environment readiness */}
            <div className={card}>
              <div className="mb-3 flex items-center justify-between">
                <span className={cardTitle.replace('mb-2 ', '')}>Detected environment</span>
                <button
                  onClick={recheck}
                  disabled={rechecking}
                  title="Re-probe your PATH after installing a tool"
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-0.5 text-[10.5px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200 disabled:opacity-50"
                >
                  {rechecking ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <RefreshCw size={11} strokeWidth={2} />
                  )}
                  Re-check
                </button>
              </div>
              {!env ? (
                <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                  <Loader2 size={14} className="animate-spin" /> probing your PATH…
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Row
                    ok={env.claude.found}
                    name="Claude"
                    hint={
                      env.claude.found ? env.claude.path : 'install the Claude CLI to run sessions'
                    }
                  />
                  <Row
                    ok={env.codex.found}
                    name="Codex"
                    hint={
                      env.codex.found ? env.codex.path : 'optional — install for the Codex engine'
                    }
                  />
                  <Row
                    ok={env.cursor.found}
                    name="Cursor"
                    hint={
                      env.cursor.found
                        ? env.cursor.path
                        : 'optional — install Cursor Agent for the Cursor engine'
                    }
                  />
                  <Row
                    ok={env.gh.found && env.gh.authed}
                    name="gh"
                    hint={
                      env.gh.found
                        ? env.gh.authed
                          ? `GitHub PRs ready${env.gh.authHost ? ` (${env.gh.authHost})` : ''}`
                          : 'run `gh auth login`'
                        : 'optional — for GitHub PRs'
                    }
                  />
                  <Row
                    ok={env.glab.found && env.glab.authed}
                    name="glab"
                    hint={
                      env.glab.found
                        ? env.glab.authed
                          ? `GitLab MRs ready${env.glab.authHost ? ` (${env.glab.authHost})` : ''}`
                          : 'run `glab auth login`'
                        : 'optional — for GitLab MRs'
                    }
                  />
                </div>
              )}
              {env && !eng && (
                <div className="mt-3 text-[11px] text-amber-400">
                  No agent engine was found — install Claude, Codex, or Cursor Agent. You can set an
                  explicit path in Settings.
                </div>
              )}
              {/* default engine — drives scheduled/agent runs, so make the pick
                  explicit instead of reconciling it silently */}
              {env && (
                <div className="mt-3 border-t border-[var(--gt-border)] pt-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[11px] text-zinc-500">Default agent engine:</span>
                    {(['codex', 'claude', 'cursor'] as Engine[]).map((e) => {
                      const missing = !engineFound(e)
                      return (
                        <button
                          key={e}
                          onClick={() => setDefaultEngine(e)}
                          title={missing ? `${e} was not found on your PATH` : undefined}
                          className={`rounded-md border px-2.5 py-1 text-[11px] capitalize ${
                            defaultEngine === e
                              ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                              : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                          } ${missing ? 'opacity-45' : ''}`}
                        >
                          {e}
                        </button>
                      )
                    })}
                  </div>
                  <div className="text-[10.5px] text-zinc-600">
                    Used for scheduled, ticket, and background agent runs.
                  </div>
                </div>
              )}
            </div>

            {/* projects dir */}
            <div className={`${card} mb-7`}>
              <div className={cardTitle}>Projects folder</div>
              <div className="mb-2 text-[11px] leading-relaxed text-zinc-600">
                The entry screen lists repos here for quick access. Leave blank to use your home
                folder.
              </div>
              <div className="flex items-center gap-2">
                <button onClick={browse} className={`${softButton} shrink-0`}>
                  <FolderOpen size={13} strokeWidth={2} />
                  Browse
                </button>
                <input
                  value={projectsDir}
                  onChange={(e) => setProjectsDir(e.target.value)}
                  placeholder="~ (home) — or e.g. ~/code"
                  spellCheck={false}
                  className={`${fieldInput} min-w-0 flex-1`}
                />
              </div>
              {projectsDirValidation?.ok &&
                typeof projectsDirValidation.repoCount === 'number' &&
                projectsDirValidation.repoCount > 0 && (
                  <div className="mt-2 text-[11px] text-[var(--gt-green)]">
                    Manages {projectsDirValidation.repoCount}{' '}
                    {projectsDirValidation.repoCount === 1 ? 'repo' : 'repos'} in this folder
                  </div>
                )}
              {projectsDirValidation &&
                !projectsDirValidation.ok &&
                projectsDirValidation.reason === 'is-repo' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
                    <span className="min-w-0 flex-1">{projectsDirValidation.message}</span>
                    {projectsDirValidation.suggestedParent && (
                      <button
                        onClick={() => setProjectsDir(projectsDirValidation.suggestedParent || '')}
                        className="rounded border border-amber-400/40 bg-black/20 px-2 py-0.5 text-[10.5px] font-semibold text-amber-100 hover:bg-amber-400/10"
                      >
                        Use parent
                      </button>
                    )}
                  </div>
                )}
              {projectsDirValidation &&
                !projectsDirValidation.ok &&
                projectsDirValidation.reason === 'no-repos-found' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
                    <span className="min-w-0 flex-1">
                      ⚠ 0 repos found here — they may be nested one level deeper.
                    </span>
                    {projectsDirValidation.suggestedChild && (
                      <button
                        onClick={() => setProjectsDir(projectsDirValidation.suggestedChild || '')}
                        className="rounded border border-amber-400/40 bg-black/20 px-2 py-0.5 text-[10.5px] font-semibold text-amber-100 hover:bg-amber-400/10"
                      >
                        Use {projectsDirValidation.suggestedChild} (
                        {projectsDirValidation.suggestedCount} repos)
                      </button>
                    )}
                  </div>
                )}
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => finish(false, false)}
                disabled={busy}
                title="Keep every default and set it up later in Settings"
                className="text-[12px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              >
                Skip for now
              </button>
              <button
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90"
              >
                Next — connections
                <ArrowRight size={15} strokeWidth={2.5} />
              </button>
            </div>
          </>
        ) : (
          <>
            {/* telegram */}
            <div className={card}>
              <div className={cardTitle}>Telegram — pings when agents finish or block</div>
              <div className="mb-2 text-[11px] leading-relaxed text-zinc-600">
                Create a bot with @BotFather, paste its token, then message @userinfobot for your
                numeric chat id.
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className={fieldLabel}>Bot token</span>
                  <input
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="123456:ABC-DEF…"
                    spellCheck={false}
                    className={fieldInput}
                  />
                </label>
                <label className="block space-y-1">
                  <span className={fieldLabel}>Chat id</span>
                  <input
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="Your numeric chat id"
                    spellCheck={false}
                    className={fieldInput}
                  />
                </label>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={testTelegram}
                  disabled={!botToken.trim() || !chatId.trim() || tg?.busy}
                  className={softButton}
                >
                  {tg?.busy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Send size={13} strokeWidth={2} />
                  )}
                  Test
                </button>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
                  <input
                    type="checkbox"
                    checked={tgNotify}
                    onChange={(e) => setTgNotify(e.target.checked)}
                    className="accent-[var(--gt-accent)]"
                  />
                  Mirror notifications to Telegram
                </label>
              </div>
              {tg && !tg.busy && (
                <div
                  className={`mt-1.5 text-[11px] ${tg.ok ? 'text-[var(--gt-green)]' : 'text-amber-400'}`}
                >
                  {tg.ok ? '✓ Sent — check your chat.' : tg.error}
                </div>
              )}
            </div>

            {/* one-click installs */}
            <div className={card}>
              <div className={cardTitle}>One-click installs</div>
              <div className="space-y-2">
                <button
                  onClick={installMcp}
                  disabled={mcp?.busy}
                  className={`${softButton} w-full`}
                >
                  {mcp?.busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <TerminalSquare
                      size={14}
                      strokeWidth={2}
                      className="text-[var(--gt-accent-light)]"
                    />
                  )}
                  Install MCP server (Claude Code + Codex)
                  <span className="ml-auto text-[10.5px] text-zinc-600">
                    {mcp?.ok ? '✓ Installed' : 'Cross-session views'}
                  </span>
                </button>
                {mcp?.error && <div className="text-[11px] text-amber-400">{mcp.error}</div>}
                <button
                  onClick={installNotify}
                  disabled={notify?.busy}
                  className={`${softButton} w-full`}
                >
                  {notify?.busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <TerminalSquare
                      size={14}
                      strokeWidth={2}
                      className="text-[var(--gt-accent-light)]"
                    />
                  )}
                  Install <span className="font-mono">gt-notify</span> hook
                  <span className="ml-auto text-[10.5px] text-zinc-600">
                    {notify?.ok ? '✓ Installed' : 'Activity feed'}
                  </span>
                </button>
                {notify?.error && <div className="text-[11px] text-amber-400">{notify.error}</div>}
              </div>
            </div>

            {/* openrouter */}
            <div className={`${card} mb-7`}>
              <div className={cardTitle}>OpenRouter API key</div>
              <div className="mb-2 text-[11px] leading-relaxed text-zinc-600">
                Optional — powers cheap-model (or-agent) runs. Stored in your OS keychain.
              </div>
              <input
                type="password"
                value={orKey}
                onChange={(e) => setOrKey(e.target.value)}
                placeholder="sk-or-v1-…"
                spellCheck={false}
                autoComplete="off"
                className={fieldInput}
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-300"
              >
                <ArrowLeft size={13} strokeWidth={2.5} />
                Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => finish(true, false)}
                  disabled={busy}
                  title="Apply step 1 only — connections stay unconfigured"
                  className="text-[12px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                >
                  Skip connections
                </button>
                <button
                  onClick={() => finish(true, true)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ArrowRight size={15} strokeWidth={2.5} />
                  )}
                  Finish
                </button>
              </div>
            </div>
          </>
        )}
        <p className="mt-4 text-center text-[10.5px] text-zinc-600">
          {step === 1
            ? 'Next step wires optional connections — Telegram, MCP, OpenRouter.'
            : 'Everything here also lives in Settings (gear icon), anytime.'}
        </p>
      </div>
    </div>
  )
}
