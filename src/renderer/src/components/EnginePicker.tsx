import { useEffect, useState } from 'react'
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
  type LucideIcon,
} from 'lucide-react'
import type { Engine, Persona, PipelineInfo } from '../lib/types'
import openaiLogo from '../assets/openai.svg'
import anthropicLogo from '../assets/anthropic.svg'

// Three-step launch picker: engine (codex/claude) → persona (none + built-ins)
// → pipeline (single run, or chained review/iterate stages). onPick fires with
// engine + persona id ('' = none) + pipeline id ('single' = just the task).
const LOGO: Record<Engine, string> = { codex: openaiLogo, claude: anthropicLogo }
const VENDOR: Record<Engine, string> = { codex: 'OpenAI Codex', claude: 'Anthropic Claude' }
const PERSONA_ICON: Record<string, LucideIcon> = {
  ShieldCheck,
  Gauge,
  Compass,
  Sparkles,
  Palette,
  FlaskConical,
  Accessibility,
  Server,
}
const PIPELINE_ICON: Record<string, LucideIcon> = {
  single: Zap,
  review: Eye,
  'review-iterate': Repeat2,
}

export function EnginePicker({
  title,
  onPick,
  onClose,
}: {
  title: string
  onPick: (engine: Engine, persona: string, pipeline: string) => void
  onClose: () => void
}) {
  const [engine, setEngine] = useState<Engine | null>(null)
  const [persona, setPersona] = useState<string | null>(null) // null = not chosen, '' = none
  const [personas, setPersonas] = useState<Persona[]>([])
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([])
  useEffect(() => {
    window.gt.agents.personas().then(setPersonas)
    window.gt.agents.pipelines().then(setPipelines)
  }, [])

  const step = engine === null ? 1 : persona === null ? 2 : 3
  const back = () => (step === 3 ? setPersona(null) : setEngine(null))

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[420px] gt-pop-in rounded-2xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          {step > 1 && (
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

        {step === 1 && (
          <>
            <p className="mb-3 text-[11.5px] text-zinc-500">1 · Launch with which engine?</p>
            <div className="grid grid-cols-2 gap-2">
              {(['codex', 'claude'] as Engine[]).map((e) => (
                <button
                  key={e}
                  onClick={() => setEngine(e)}
                  className="flex flex-col items-center gap-2 rounded-xl border border-[var(--gt-border)] bg-black/20 px-3 py-4 transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
                >
                  <img src={LOGO[e]} alt="" className="h-7 w-7" draggable={false} />
                  <span className="text-[13px] font-semibold text-zinc-100">{e}</span>
                  <span className="text-[10px] text-zinc-500">{VENDOR[e]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="mb-3 text-[11.5px] text-zinc-500">
              2 · Run as a persona? <span className="text-zinc-600">(via {engine})</span>
            </p>
            <div className="max-h-[320px] space-y-1.5 overflow-y-auto">
              <button
                onClick={() => setPersona('')}
                className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--gt-border)] bg-black/20 p-3 text-left transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
              >
                <Ban size={17} strokeWidth={1.75} className="shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-zinc-100">None</div>
                  <div className="text-[11px] text-zinc-500">Default — just the task.</div>
                </div>
              </button>
              {personas.map((p) => {
                const Icon = PERSONA_ICON[p.icon || ''] || UserRound
                return (
                  <button
                    key={p.id}
                    onClick={() => setPersona(p.id)}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--gt-border)] bg-black/20 p-3 text-left transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
                  >
                    <Icon size={17} strokeWidth={1.75} className="shrink-0 text-[var(--gt-accent-light)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-zinc-100">{p.title}</div>
                      <div className="text-[11px] leading-snug text-zinc-500">{p.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="mb-3 text-[11.5px] text-zinc-500">
              3 · Pipeline?{' '}
              <span className="text-zinc-600">
                ({engine}
                {persona ? ` · ${personas.find((p) => p.id === persona)?.title || persona}` : ''})
              </span>
            </p>
            <div className="max-h-[320px] space-y-1.5 overflow-y-auto">
              {pipelines.map((pl) => {
                const Icon = PIPELINE_ICON[pl.id] || Layers
                return (
                  <button
                    key={pl.id}
                    onClick={() => onPick(engine as Engine, persona ?? '', pl.id)}
                    className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--gt-border)] bg-black/20 p-3 text-left transition-colors hover:border-[var(--gt-accent)]/60 hover:bg-white/5"
                  >
                    <Icon size={17} strokeWidth={1.75} className="shrink-0 text-[var(--gt-accent-light)]" />
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
      </div>
    </div>
  )
}
