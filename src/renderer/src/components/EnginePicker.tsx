import { useEffect, useState, type ReactNode } from 'react'
import {
  X,
  ChevronLeft,
  Ban,
  ShieldCheck,
  Gauge,
  Compass,
  Sparkles,
  Palette,
  FlaskConical,
  Accessibility,
  Server,
  UserRound,
  Zap,
  Eye,
  Repeat2,
  Layers,
  Cpu,
  SquareTerminal,
  Brain,
  type LucideIcon,
} from 'lucide-react'
import type { Engine, Persona, PipelineInfo, EnvDetect } from '../lib/types'
import type { LaunchMode } from '../lib/launch'
import { ModelSelect } from './ModelSelect'
import { SkillHint } from './SkillHint'
import { EngineLogo } from './EngineLogo'
import { engineLabel } from '../lib/engines'

// Three-step launch picker: engine → agent context (none + classic/persistent)
// → pipeline (single run, or chained review/iterate stages). onPick fires with
// engine + context id ('' = none) + pipeline id ('single' = just the task).
const VENDOR: Record<Engine, string> = {
  codex: 'OpenAI Codex',
  claude: 'Anthropic Claude',
  cursor: 'Cursor Agent',
  openrouter: 'OpenRouter · Codex or Hermes',
  hermes: 'Nous Hermes',
  'openai-compat': 'Self-hosted · OpenAI-compatible',
}
const PERSONA_ICON: Record<string, LucideIcon> = {
  ShieldCheck,
  Gauge,
  Compass,
  Sparkles,
  Palette,
  FlaskConical,
  Accessibility,
  Server,
  Brain,
}
const PIPELINE_ICON: Record<string, LucideIcon> = {
  single: Zap,
  review: Eye,
  'review-iterate': Repeat2,
}

export function EnginePicker({
  title,
  hint,
  showPersona = true,
  showPipeline = true,
  showLanes = false,
  showExtraContext = false,
  initialPersona,
  onPick,
  onClose,
}: {
  title: string
  hint?: ReactNode
  showPersona?: boolean
  showPipeline?: boolean
  /** Show the lane-count stepper on the launch step (process mode only).
   *  N>1 fans out N parallel variant attempts, each its own worktree + MR. */
  showLanes?: boolean
  /** Show a free-text "additional context for this run" box on the launch step. */
  showExtraContext?: boolean
  initialPersona?: string
  onPick: (
    engine: Engine,
    persona: string,
    pipeline: string,
    model?: string,
    launchMode?: LaunchMode,
    runContext?: Persona,
    lanes?: number,
    openrouterHarness?: 'codex' | 'hermes',
    extraContext?: string,
  ) => void
  onClose: () => void
}) {
  const [engine, setEngine] = useState<Engine | null>(null)
  const [model, setModel] = useState<string | undefined>(undefined)
  const [openrouterHarness, setOpenrouterHarness] = useState<'codex' | 'hermes'>('codex')
  const [extraContext, setExtraContext] = useState('')
  const [modelConfirmed, setModelConfirmed] = useState(false)
  const [persona, setPersona] = useState<string | null>(showPersona ? null : '') // null = not chosen, '' = none
  const [personaConfirmed, setPersonaConfirmed] = useState(!showPersona)
  const [pipeline, setPipeline] = useState<string | null>(showPipeline ? null : 'single')
  const [lanes, setLanes] = useState(1)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([])
  const [env, setEnv] = useState<EnvDetect | null>(null)
  const [defaultEngine, setDefaultEngine] = useState<Engine>('claude')
  // Self-hosted servers have no fallback slug — "default" is only meaningful
  // when Settings configures one, so the model step gates Continue on it.
  const [ocDefaultModel, setOcDefaultModel] = useState('')
  useEffect(() => {
    if (showPersona) {
      window.gt.agents.personas().then((next) => {
        setPersonas(next)
        if (initialPersona && next.some((p) => p.id === initialPersona)) {
          setPersona(initialPersona)
          setPersonaConfirmed(false)
        }
      })
    }
    if (showPipeline) window.gt.agents.pipelines().then(setPipelines)
    window.gt.detectEnv().then(setEnv)
    window.gt.settings.get().then((s) => {
      setDefaultEngine(s.defaultEngine)
      setOcDefaultModel(s.engines['openai-compat']?.defaultModel || '')
    })
  }, [showPersona, showPipeline, initialPersona])

  // Until detection resolves, assume available (avoids a flicker); once known,
  // disable engines that aren't installed and auto-pick when only one exists.
  // OpenRouter and openai-compat ride the or-agent (Codex) harness, so their
  // readiness tracks Codex being installed; key/base URL validate at run time.
  const avail = (e: Engine) =>
    !env ||
    (e === 'hermes'
      ? true // resolved via PATH; validated at run time
      : e === 'codex' || e === 'openrouter' || e === 'openai-compat'
        ? env.codex.found
        : e === 'cursor'
          ? env.cursor.found
          : env.claude.found)
  useEffect(() => {
    if (!env || engine !== null) return
    const ok = (['codex', 'claude', 'cursor'] as Engine[]).filter(avail)
    if (ok.length === 1) setEngine(ok[0])
  }, [env]) // eslint-disable-line react-hooks/exhaustive-deps
  const engineOrder: Engine[] = [
    defaultEngine,
    ...(['claude', 'codex', 'cursor', 'openrouter', 'hermes', 'openai-compat'] as Engine[]).filter(
      (e) => e !== defaultEngine,
    ),
  ]
  const selectedContext = persona ? personas.find((p) => p.id === persona) : undefined

  const step =
    engine === null
      ? 'engine'
      : !modelConfirmed
        ? 'model'
        : showPersona && !personaConfirmed
          ? 'persona'
          : showPipeline && pipeline === null
            ? 'pipeline'
            : 'launch'
  const totalSteps = 3 + (showPersona ? 1 : 0) + (showPipeline ? 1 : 0)
  const stepNum =
    step === 'engine'
      ? 1
      : step === 'model'
        ? 2
        : step === 'persona'
          ? 3
          : step === 'pipeline'
            ? 3 + (showPersona ? 1 : 0)
            : totalSteps
  const back = () => {
    if (step === 'launch') {
      if (showPipeline) setPipeline(null)
      else if (showPersona) setPersonaConfirmed(false)
      else setModelConfirmed(false)
      return
    }
    if (step === 'pipeline') {
      if (showPersona) setPersonaConfirmed(false)
      else setModelConfirmed(false)
      return
    }
    if (step === 'persona') setModelConfirmed(false)
    if (step === 'model') setEngine(null)
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[420px] gt-pop-in rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          {step !== 'engine' && (
            <button
              onClick={back}
              className="flex items-center rounded p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            >
              <ChevronLeft size={15} strokeWidth={2} />
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold text-zinc-100">{title}</h2>
          <button
            onClick={onClose}
            className="flex shrink-0 items-center rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        {hint && (
          <div className="mb-3">
            <SkillHint>{hint}</SkillHint>
          </div>
        )}

        {step === 'engine' && (
          <>
            <p className="mb-3 text-[11.5px] text-zinc-500">
              {stepNum} · Launch with which engine?
            </p>
            <div className="grid grid-cols-3 gap-2">
              {engineOrder.map((e) => {
                const ok = avail(e)
                return (
                  <button
                    key={e}
                    onClick={() => {
                      if (!ok) return
                      setEngine(e)
                      setModel(undefined)
                      setModelConfirmed(false)
                    }}
                    disabled={!ok}
                    title={ok ? '' : `${engineLabel(e)} is not installed or not on PATH`}
                    className={`flex flex-col items-center gap-2 rounded-xl border bg-black/20 px-3 py-4 transition-colors ${
                      ok
                        ? 'border-[var(--gt-border)] hover:border-[var(--gt-accent)]/60 hover:bg-white/5'
                        : 'cursor-not-allowed border-[var(--gt-border)]/50 opacity-40'
                    }`}
                  >
                    <EngineLogo engine={e} size={28} />
                    <span className="text-[13px] font-semibold text-zinc-100">
                      {engineLabel(e)}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {ok ? VENDOR[e] : 'Not installed'}
                    </span>
                  </button>
                )
              })}
            </div>
            {env && !env.codex.found && !env.claude.found && !env.cursor.found && (
              <p className="mt-3 text-[11px] text-[var(--gt-red)]">
                No agent engine was found on PATH. Install Claude, Codex, or Cursor Agent, or set
                its path in Settings.
              </p>
            )}
          </>
        )}

        {step === 'model' && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <EngineLogo engine={engine as Engine} size={16} />
              <p className="text-[11.5px] text-zinc-500">
                {stepNum} · Model{' '}
                <span className="text-zinc-600">for {engineLabel(engine || '')}</span>
              </p>
            </div>
            {engine === 'openrouter' && (
              <div className="mb-3">
                <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-zinc-500">
                  Harness
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['codex', 'hermes'] as const).map((h) => (
                    <button
                      key={h}
                      onClick={() => setOpenrouterHarness(h)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                        openrouterHarness === h
                          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                          : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <EngineLogo engine={h} size={15} />
                      <span className="text-[12px] font-semibold">
                        {h === 'codex' ? 'Codex' : 'Hermes'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="max-h-[340px] overflow-y-auto pr-0.5">
              <ModelSelect engine={engine as Engine} model={model} onChange={setModel} />
            </div>
            {engine === 'openai-compat' && !model && !ocDefaultModel ? (
              <button
                disabled
                className="mt-3 w-full cursor-not-allowed rounded-xl border border-[var(--gt-border)] bg-black/20 px-3 py-2 text-[12px] font-semibold text-zinc-600"
                title="A self-hosted server has no fallback slug — enter the model it serves, or set the engine default in Settings → Engines → Self-hosted."
              >
                Enter the model your server serves
              </button>
            ) : (
              <button
                onClick={() => setModelConfirmed(true)}
                className="mt-3 w-full rounded-xl border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/15 px-3 py-2 text-[12px] font-semibold text-zinc-100 transition-colors hover:bg-[var(--gt-accent)]/25"
              >
                Continue with{' '}
                {model ||
                  (engine === 'openai-compat'
                    ? `the default (${ocDefaultModel})`
                    : 'the default model')}
              </button>
            )}
          </>
        )}

        {step === 'persona' && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <p className="text-[11.5px] text-zinc-500">
                {stepNum} · Run with an agent context?{' '}
                <span className="text-zinc-600">
                  (via {engineLabel(engine || '')} · {model || 'default'})
                </span>
              </p>
            </div>
            <div className="max-h-[320px] space-y-1.5 overflow-y-auto">
              <button
                onClick={() => {
                  setPersona('')
                  setPersonaConfirmed(true)
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5 ${
                  persona === ''
                    ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/10'
                    : 'border-[var(--gt-border)] bg-black/20'
                }`}
              >
                <Ban size={17} strokeWidth={1.75} className="shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-zinc-100">None</div>
                  <div className="text-[11px] text-zinc-500">Default — just the task.</div>
                </div>
              </button>
              {personas.map((p) => {
                const Icon = PERSONA_ICON[p.icon || ''] || UserRound
                const selected = persona === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPersona(p.id)
                      setPersonaConfirmed(true)
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5 ${
                      selected
                        ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/10'
                        : 'border-[var(--gt-border)] bg-black/20'
                    }`}
                  >
                    <Icon
                      size={17}
                      strokeWidth={1.75}
                      className="shrink-0 text-[var(--gt-accent-light)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-zinc-100">{p.title}</div>
                      <div className="text-[11px] leading-snug text-zinc-500">{p.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
            {persona !== null && (
              <button
                onClick={() => setPersonaConfirmed(true)}
                className="mt-3 w-full rounded-xl border border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/15 px-3 py-2 text-[12px] font-semibold text-zinc-100 transition-colors hover:bg-[var(--gt-accent)]/25"
              >
                Continue with {persona ? selectedContext?.title || persona : 'no agent context'}
              </button>
            )}
          </>
        )}

        {step === 'pipeline' && (
          <>
            <p className="mb-3 text-[11.5px] text-zinc-500">
              {stepNum} · Pipeline?{' '}
              <span className="text-zinc-600">
                ({engineLabel(engine || '')}
                {persona ? ` · ${selectedContext?.title || persona}` : ''})
              </span>
            </p>
            <div className="max-h-[320px] space-y-1.5 overflow-y-auto">
              {pipelines.map((pl) => {
                const Icon = PIPELINE_ICON[pl.id] || Layers
                return (
                  <button
                    key={pl.id}
                    onClick={() => setPipeline(pl.id)}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--gt-border)] bg-black/20 p-3 text-left transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
                  >
                    <Icon
                      size={17}
                      strokeWidth={1.75}
                      className="shrink-0 text-[var(--gt-accent-light)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-zinc-100">{pl.title}</div>
                      <div className="text-[11px] leading-snug text-zinc-500">{pl.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {step === 'launch' && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <p className="text-[11.5px] text-zinc-500">
                {stepNum} · Launch as{' '}
                <span className="text-zinc-600">
                  ({engineLabel(engine || '')} · {model || 'default'}
                  {persona ? ` · ${selectedContext?.title || persona}` : ''}
                  {pipeline && pipeline !== 'single' ? ` · ${pipeline}` : ''}
                  {showLanes && lanes > 1 ? ` · ${lanes} lanes` : ''})
                </span>
              </p>
            </div>
            {showExtraContext && (
              <div className="mb-3">
                <div className="mb-1.5 text-[10.5px] uppercase tracking-wide text-zinc-500">
                  Additional context (this run only)
                </div>
                <textarea
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  rows={3}
                  placeholder="Optional — extra instructions/context appended to this run's prompt (not saved to the agent)."
                  className="w-full resize-none rounded-xl border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60"
                />
              </div>
            )}
            {showLanes && (
              <div className="mb-3 rounded-xl border border-[var(--gt-border)] bg-black/20 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-zinc-300">Lanes</span>
                  <span className="text-[10px] text-zinc-600">
                    parallel variant attempts · process mode
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setLanes(n)}
                      className={`min-w-[34px] rounded-lg border px-2 py-1 text-[12px] font-semibold transition-colors ${
                        lanes === n
                          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-[var(--gt-accent-light)]'
                          : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={lanes}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1)))
                      setLanes(v)
                    }}
                    className="ml-1 w-[58px] rounded-lg border border-[var(--gt-border)] bg-[var(--gt-bg)] px-2 py-1 text-[12px] text-zinc-100 outline-none focus:border-[var(--gt-accent)]/60"
                    title="Custom lane count (1–100)"
                  />
                </div>
                {lanes > 1 && (
                  <p className="mt-2 text-[10px] leading-snug text-zinc-600">
                    {lanes} independent worktrees/branches, each opening its own{' '}
                    {/* judge is v2; v1 opens all + you compare */}MR. Compare and pick the winner;
                    requires the ticket to have acceptance criteria.
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() =>
                  onPick(
                    engine as Engine,
                    persona ?? '',
                    pipeline || 'single',
                    model,
                    'terminal',
                    selectedContext,
                    1,
                    openrouterHarness,
                    extraContext.trim() || undefined,
                  )
                }
                className="flex flex-col items-center gap-2 rounded-xl border border-[var(--gt-border)] bg-black/20 px-3 py-4 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
              >
                <SquareTerminal
                  size={24}
                  strokeWidth={1.8}
                  className="text-[var(--gt-accent-light)]"
                />
                <span className="text-[13px] font-semibold text-zinc-100">
                  {engine === 'claude'
                    ? 'Claude Code'
                    : engine === 'cursor'
                      ? 'Cursor Agent'
                      : engine === 'hermes'
                        ? 'Hermes'
                        : engine === 'openrouter'
                          ? `${openrouterHarness === 'hermes' ? 'Hermes' : 'Codex'} · OpenRouter`
                          : 'Codex'}{' '}
                  instance
                </span>
                <span className="text-center text-[10px] leading-snug text-zinc-500">
                  {showLanes && lanes > 1
                    ? 'Single interactive run (lanes need process mode).'
                    : 'Open Terminal with the prompt prefilled.'}
                </span>
              </button>
              <button
                onClick={() =>
                  onPick(
                    engine as Engine,
                    persona ?? '',
                    pipeline || 'single',
                    model,
                    'process',
                    selectedContext,
                    showLanes ? lanes : 1,
                    openrouterHarness,
                    extraContext.trim() || undefined,
                  )
                }
                className="flex flex-col items-center gap-2 rounded-xl border border-[var(--gt-border)] bg-black/20 px-3 py-4 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
              >
                <Cpu size={24} strokeWidth={1.8} className="text-[var(--gt-accent-light)]" />
                <span className="text-[13px] font-semibold text-zinc-100">
                  {showLanes && lanes > 1 ? `Process · ${lanes} lanes` : 'Process'}
                </span>
                <span className="text-center text-[10px] leading-snug text-zinc-500">
                  {showLanes && lanes > 1
                    ? `Fan out ${lanes} parallel variant runs.`
                    : 'Fire-and-forget background run.'}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
