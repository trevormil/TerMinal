import { useState } from 'react'
import { Eye, Repeat2, Check, type LucideIcon } from 'lucide-react'
import { EnginePicker } from './EnginePicker'
import type { AgentDefinition, Engine, Persona } from '../lib/types'
import { openPromptInTerminal } from '../lib/launch'
import { prAgentPrompt } from '../lib/agentPrompts'

// Spin a Codex/Claude agent out onto an open MR: Review or Iterate. The agent
// checks out the MR head in its own worktree and pushes fixes back to the
// source branch (see runPrAgent in main/agents.ts).
type PrLite = { iid: number; sourceBranch: string; title?: string; webUrl?: string }

export function PrAgentActions({ pr, sym = '!' }: { pr: PrLite; sym?: string }) {
  const [kind, setKind] = useState<'review' | 'iterate' | null>(null)
  const [done, setDone] = useState<{ msg: string; ok: boolean } | null>(null)

  const launch = async (
    engine: Engine,
    persona: string,
    pipeline: string,
    model?: string,
    launchMode?: 'process' | 'terminal',
    runContext?: Persona,
  ) => {
    const k = kind
    setKind(null)
    if (!k) return
    if (launchMode === 'terminal') {
      const meta = await window.gt.meta()
      let reviewAgent: AgentDefinition | undefined
      if (k === 'review') {
        const defs = await window.gt.agents.definitions().catch(() => [])
        reviewAgent = defs.find((d) => d.ref.id === 'code-review' && d.ref.kind === 'classic')
      }
      openPromptInTerminal({
        engine,
        cwd: meta.cwd,
        name: `${k} ${sym}${pr.iid}`,
        prompt: prAgentPrompt(pr, k, {
          forgeSym: sym,
          persona,
          pipeline,
          model,
          runContext,
          reviewAgent,
        }),
        remote: meta.remote,
      })
      setDone({ msg: 'Opened instance', ok: true })
      setTimeout(() => setDone(null), 4000)
      return
    }
    const meta = await window.gt.meta()
    const r = await window.gt.agents.runPr(pr, k, engine, persona, pipeline, model, meta.remote)
    const ok = !('error' in r)
    setDone({ msg: ok ? `${k} spun out` : (r as { error: string }).error, ok })
    setTimeout(() => setDone(null), ok ? 4000 : 6000)
  }

  const btn = (k: 'review' | 'iterate', Icon: LucideIcon, label: string) => (
    <button
      onClick={(ev) => {
        ev.stopPropagation()
        setKind(k)
      }}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
    >
      <Icon size={12} strokeWidth={2} />
      {label}
    </button>
  )

  return (
    <>
      {done ? (
        <span
          className={`inline-flex items-center gap-1 text-[11px] ${done.ok ? 'text-emerald-400' : 'text-amber-400'}`}
        >
          {done.ok && <Check size={12} strokeWidth={2.5} />}
          {done.msg}
        </span>
      ) : (
        <>
          {btn('review', Eye, 'Review')}
          {btn('iterate', Repeat2, 'Iterate')}
        </>
      )}
      {kind && (
        <EnginePicker
          title={`${kind === 'review' ? 'Review' : 'Iterate'} · ${sym}${pr.iid}`}
          showPersona={false}
          showPipeline={false}
          hint={
            <>
              Review uses the <code className="font-mono text-zinc-300">code-review</code> agent
              definition; override that agent to customize reviewer model, rubric, artifacts, or
              checks.
            </>
          }
          onClose={() => setKind(null)}
          onPick={launch}
        />
      )}
    </>
  )
}
