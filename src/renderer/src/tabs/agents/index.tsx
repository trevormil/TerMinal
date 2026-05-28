import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Play,
  BookText,
  ScanSearch,
  ListChecks,
  Square,
  Trash2,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import type { BadgeTone } from '../../components/ui'
import type { Tab, TabContext, Agent, AgentRun } from '../../lib/types'

const AGENT_ICON: Record<string, LucideIcon> = {
  BookText,
  ScanSearch,
  ListChecks,
  Bot,
}
const statusTone = (s: string): BadgeTone =>
  s === 'done' ? 'green' : s === 'failed' ? 'red' : s === 'canceled' ? 'mute' : 'blue'
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')

function reltime(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

function AgentsTab({ ctx }: { ctx: TabContext }) {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    window.gt.agents.list().then(setAgents)
    window.gt.agents.runs().then((rs) => {
      setRuns(rs)
      setOutputs((o) => {
        const next = { ...o }
        for (const r of rs) if (next[r.id] === undefined) next[r.id] = r.output
        return next
      })
      if (rs[0]) setSel((s) => s ?? rs[0].id)
    })
    const offStatus = window.gt.agents.onStatus((run) => {
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.id === run.id)
        if (i < 0) return [run, ...prev]
        const next = [...prev]
        next[i] = run
        return next
      })
      setOutputs((o) => (o[run.id] === undefined ? { ...o, [run.id]: run.output } : o))
      setSel((s) => s ?? run.id)
    })
    const offOutput = window.gt.agents.onOutput(({ runId, chunk }) => {
      setOutputs((o) => ({ ...o, [runId]: (o[runId] || '') + chunk }))
    })
    return () => {
      offStatus()
      offOutput()
    }
  }, [ctx.sessionId])

  const selectedRun = runs.find((r) => r.id === sel) || null
  const runningByAgent = useMemo(
    () => new Set(runs.filter((r) => r.status === 'running').map((r) => r.agentId)),
    [runs],
  )

  // auto-scroll the log when the selected run's output grows
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sel, selectedRun && outputs[selectedRun.id]])

  const run = async (id: string) => {
    const r = await window.gt.agents.run(id)
    if ('error' in r) {
      setOutputs((o) => ({ ...o, __err: r.error }))
      return
    }
    setRuns((prev) => [r, ...prev.filter((x) => x.id !== r.id)])
    setSel(r.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <Bot size={14} strokeWidth={2} className="text-zinc-400" />
        <span className="text-[12px] font-semibold text-zinc-200">Agents</span>
        <span className="text-[11px] text-zinc-600">
          codex · own worktree · opens a PR · {ctx.repoPath || ctx.repoRoot.replace(/^.*\//, '')}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* agents + runs (left) */}
        <div className="flex w-[42%] min-w-[320px] flex-col border-r border-[var(--gt-border)]">
          <div className="shrink-0 space-y-2 overflow-y-auto p-3" style={{ maxHeight: '55%' }}>
            {agents === null ? (
              <div className="p-3 text-[12px] text-zinc-600">Loading…</div>
            ) : agents.length === 0 ? (
              <div className="p-3 text-[12px] text-zinc-600">
                No agents. Define them in <span className="font-mono">.agents/agents.json</span>.
              </div>
            ) : (
              agents.map((a) => {
                const Icon = AGENT_ICON[a.icon || ''] || Bot
                const busy = runningByAgent.has(a.id)
                return (
                  <div
                    key={a.id}
                    className="rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <Icon size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-zinc-100">{a.title}</div>
                        {a.description && (
                          <div className="text-[11.5px] leading-snug text-zinc-500">{a.description}</div>
                        )}
                      </div>
                      <button
                        onClick={() => run(a.id)}
                        disabled={busy}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                      >
                        {busy ? (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-white gt-pulse" />
                            Running
                          </>
                        ) : (
                          <>
                            <Play size={13} strokeWidth={2.5} />
                            Run
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--gt-border)]">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">
              Runs
            </div>
            {runs.length === 0 ? (
              <div className="px-3 pb-3 text-[12px] text-zinc-600">No runs yet.</div>
            ) : (
              runs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSel(r.id)}
                  className={`flex w-full items-center gap-2 border-b border-[var(--gt-border)]/50 px-3 py-2 text-left hover:bg-white/5 ${
                    sel === r.id ? 'bg-white/5' : ''
                  }`}
                >
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-200">{r.agentTitle}</span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-600">{r.branch.split('/').pop()}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{reltime(r.startedAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* selected run output (right) */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!selectedRun ? (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              Run an agent to see its output.
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
                <Badge tone={statusTone(selectedRun.status)}>{selectedRun.status}</Badge>
                <span className="text-[12px] font-semibold text-zinc-100">{selectedRun.agentTitle}</span>
                <span className="font-mono text-[10.5px] text-zinc-600">{selectedRun.branch}</span>
                <div className="flex-1" />
                {selectedRun.status === 'running' && (
                  <button
                    onClick={() => window.gt.agents.cancel(selectedRun.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                  >
                    <Square size={11} strokeWidth={2} />
                    Cancel
                  </button>
                )}
                <button
                  onClick={() => window.gt.openExternal(`file://${selectedRun.worktree}`)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/60"
                >
                  <FolderOpen size={11} strokeWidth={2} />
                  Worktree
                </button>
                {selectedRun.status !== 'running' && (
                  <button
                    onClick={async () => {
                      await window.gt.agents.removeWorktree(selectedRun.id)
                    }}
                    title="Remove the worktree (branch/PR stay)"
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-500 hover:border-[var(--gt-red)]/60 hover:text-[var(--gt-red)]"
                  >
                    <Trash2 size={11} strokeWidth={2} />
                  </button>
                )}
              </div>
              <pre
                ref={logRef}
                className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[#0c0c11] p-4 font-mono text-[11.5px] leading-relaxed text-zinc-300"
              >
                {stripAnsi(outputs[selectedRun.id] || '') || '…'}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'agents',
  title: 'Agents',
  icon: Bot,
  order: 1.8,
  appliesTo: (ctx) => ctx.hasAgents,
  badge: async (gt) => (await gt.agents.runs()).filter((r) => r.status === 'running').length,
  Component: AgentsTab,
}
export default tab
