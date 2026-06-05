import { useState } from 'react'
import { Eye, Repeat2, Check, type LucideIcon } from 'lucide-react'
import { EnginePicker } from './EnginePicker'
import type { Engine } from '../lib/types'
import { openPromptInTerminal } from '../lib/launch'
import { prAgentPrompt } from '../lib/agentPrompts'

// Spin a Codex/Claude agent out onto an open MR: Review or Iterate. The agent
// checks out the MR head in its own worktree and pushes fixes back to the
// source branch (see runPrAgent in main/agents.ts).
type PrLite = { iid: number; sourceBranch: string; title?: string; webUrl?: string }

export function PrAgentActions({ pr, sym = '!' }: { pr: PrLite; sym?: string }) {
  const [kind, setKind] = useState<'review' | 'iterate' | null>(null)
  const [done, setDone] = useState<{ msg: string; ok: boolean } | null>(null)

  const launch = async (engine: Engine, persona: string, pipeline: string, model?: string, launchMode?: 'process' | 'terminal') => {
    const k = kind
    setKind(null)
    if (!k) return
    if (launchMode === 'terminal') {
      const meta = await window.gt.meta()
      openPromptInTerminal({
        engine,
        cwd: meta.cwd,
        name: `${k} ${sym}${pr.iid}`,
        prompt: prAgentPrompt(pr, k, { forgeSym: sym, persona, pipeline, model }),
        remote: meta.remote,
      })
      setDone({ msg: 'opened instance', ok: true })
      setTimeout(() => setDone(null), 4000)
      return
    }
    const r = await window.gt.agents.runPr(pr, k, engine, persona, pipeline, model)
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
          {btn('review', Eye, 'review')}
          {btn('iterate', Repeat2, 'iterate')}
        </>
      )}
      {kind && (
        <EnginePicker
          title={`${kind === 'review' ? 'Review' : 'Iterate'} · ${sym}${pr.iid}`}
          showPersona={false}
          showPipeline={false}
          hint={
            <>
              You can also start review work from the terminal with{' '}
              <code className="font-mono text-zinc-300">/code-review</code> or{' '}
              <code className="font-mono text-zinc-300">$code-review</code>.
            </>
          }
          onClose={() => setKind(null)}
          onPick={launch}
        />
      )}
    </>
  )
}
