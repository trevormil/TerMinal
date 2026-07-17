import { useEffect, useState } from 'react'
import { FolderOpen, CircleCheck, CircleSlash, ArrowRight, Loader2, RefreshCw } from 'lucide-react'
import type { EnvDetect, ProjectsDirValidation } from '../lib/types'
import logo from '../assets/logo.png'

// First-run welcome. Everything here has a working default, so "skip" is safe —
// it just confirms the projects dir and surfaces which tools are present. Full
// configuration (Telegram, engine paths, forge override) lives in Settings.

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

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [env, setEnv] = useState<EnvDetect | null>(null)
  const [projectsDir, setProjectsDir] = useState('')
  const [projectsDirValidation, setProjectsDirValidation] = useState<ProjectsDirValidation | null>(
    null,
  )
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
    window.gt.settings.get().then((s) => setProjectsDir(s.projectsDir))
  }, [])

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
  // "Get started" applies the choices made on this screen; "Skip for now"
  // marks onboarding done and nothing else, leaving every setting on its
  // stock default (skipping stays safe — Settings covers it all later).
  const finish = async (apply: boolean) => {
    setBusy(true)
    // Reconcile the default agent engine with what's actually installed. The
    // stock default is codex, but a fresh user may have only claude (or cursor)
    // — leaving it on an absent binary makes every scheduled/agent run silently
    // no-op. Point it at a detected engine (codex preferred, then claude, then
    // cursor); leave it untouched if none were found.
    const detectedDefault = env?.codex.found
      ? 'codex'
      : env?.claude.found
        ? 'claude'
        : env?.cursor.found
          ? 'cursor'
          : undefined
    await window.gt.settings.patch(
      apply
        ? {
            projectsDir: projectsDir.trim(),
            onboarded: true,
            ...(detectedDefault ? { defaultEngine: detectedDefault } : {}),
          }
        : { onboarded: true },
    )
    onDone()
  }

  const eng = env && (env.codex.found || env.claude.found || env.cursor.found)

  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--gt-bg)]">
      <div className="mx-auto max-w-xl px-8 py-12">
        <div className="mb-2 flex items-center gap-3">
          <img src={logo} alt="" draggable={false} className="h-10 w-10 rounded-xl" />
          <h1 className="gt-grad-text text-2xl font-bold tracking-tight">Welcome to TerMinal</h1>
        </div>
        <p className="mb-7 text-sm text-zinc-500">
          Mission control for AI coding agents. Quick one-time setup — everything has a sensible
          default, and you can change it all later in Settings.
        </p>

        {/* environment readiness */}
        <div className="mb-5 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
              Detected environment
            </span>
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
                hint={env.claude.found ? env.claude.path : 'install the Claude CLI to run sessions'}
              />
              <Row
                ok={env.codex.found}
                name="Codex"
                hint={env.codex.found ? env.codex.path : 'optional — install for the Codex engine'}
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
        </div>

        {/* projects dir */}
        <div className="mb-7 rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            Projects folder
          </div>
          <div className="mb-2 text-[11px] leading-relaxed text-zinc-600">
            The entry screen lists repos here for quick access. Leave blank to use your home folder.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={browse}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-200 hover:border-[var(--gt-accent)]/60"
            >
              <FolderOpen size={13} strokeWidth={2} />
              Browse
            </button>
            <input
              value={projectsDir}
              onChange={(e) => setProjectsDir(e.target.value)}
              placeholder="~ (home) — or e.g. ~/code"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 font-mono text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
            />
          </div>
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
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => finish(false)}
            title="Keep every default and set it up later in Settings"
            className="text-[12px] text-zinc-500 hover:text-zinc-300"
          >
            Skip for now
          </button>
          <button
            onClick={() => finish(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ArrowRight size={15} strokeWidth={2.5} />
            )}
            Get started
          </button>
        </div>
        <p className="mt-4 text-center text-[10.5px] text-zinc-600">
          Telegram notifications, engine paths, and forge preferences are all in Settings (gear
          icon).
        </p>
      </div>
    </div>
  )
}
