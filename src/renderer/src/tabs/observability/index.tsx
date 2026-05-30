import { useEffect, useMemo, useState } from 'react'
import { DollarSign, Activity, RefreshCw } from 'lucide-react'
import { Badge } from '../../components/ui'
import { EngineLogo } from '../../components/EngineLogo'
import type { Tab, TabContext } from '../../lib/types'

// AI fleet observability — cost, tokens, models, agents. Reads ledger written
// by main/ai-collectors (Claude transcripts, Codex transcripts, claude -p,
// codex exec). Local-first; no SaaS.

type Range = 'today' | 'week' | 'month' | 'all'

const fmtUsd = (n: number): string => {
  if (!Number.isFinite(n)) return '$0.00'
  if (n >= 100) return `$${n.toFixed(0)}`
  if (n >= 10) return `$${n.toFixed(2)}`
  return `$${n.toFixed(3).replace(/\.?0+$/, '')}`
}
const fmtNum = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
const fmtWhen = (ts?: number): string => {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return sameDay ? t : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t}`
}
const fmtDur = (ms?: number): string => {
  if (!ms || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  return `${Math.floor(ms / 3_600_000)}h`
}

// Per-source palette
const SOURCE_TONE: Record<string, 'green' | 'blue' | 'accent' | 'yellow'> = {
  'claude-code': 'green',
  'claude-p': 'blue',
  'codex-cli': 'accent',
  'codex-exec': 'yellow',
}

function ObservabilityTab(_props: { ctx: TabContext }) {
  const [range, setRange] = useState<Range>('today')
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof window.gt.observability.summary>> | null>(null)
  const [byAgent, setByAgent] = useState<Awaited<ReturnType<typeof window.gt.observability.byAgent>> | null>(null)
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof window.gt.observability.daily>> | null>(null)
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof window.gt.observability.runs>> | null>(null)

  const reload = async () => {
    const [s, a, d, r] = await Promise.all([
      window.gt.observability.summary(range),
      window.gt.observability.byAgent(range),
      window.gt.observability.daily(14),
      window.gt.observability.runs(100),
    ])
    setSummary(s)
    setByAgent(a)
    setDaily(d)
    setRuns(r)
  }

  useEffect(() => {
    reload()
    const t = setInterval(reload, 30_000)
    return () => clearInterval(t)
  }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stacked bar chart for per-day spend by model family.
  const dailyMax = useMemo(() => {
    if (!daily) return 1
    return Math.max(1, ...daily.map((d) => d.usd))
  }, [daily])

  const familyOf = (model: string): 'claude' | 'codex' | 'other' => {
    if (model.toLowerCase().includes('claude') || ['haiku', 'sonnet', 'opus'].includes(model.toLowerCase()))
      return 'claude'
    if (model.toLowerCase().includes('gpt') || model.toLowerCase().includes('codex') || model.toLowerCase().includes('o4'))
      return 'codex'
    return 'other'
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <Activity size={14} strokeWidth={2} className="text-[var(--gt-accent)]" />
        <span className="text-[12px] font-semibold text-zinc-200">Observability</span>
        <div className="ml-1 flex items-center gap-0.5 rounded-lg border border-[var(--gt-border)] p-0.5">
          {(['today', 'week', 'month', 'all'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2 py-0.5 text-[11px] capitalize ${
                range === r ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={reload}
          title="Reload"
          className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        >
          <RefreshCw size={11} strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        {/* Top cards */}
        <div className="grid grid-cols-4 gap-2">
          {(() => {
            const totalUsd = summary?.totalUsd || 0
            const totalRuns = summary?.totalRuns || 0
            const claudeSpend =
              (summary?.bySource['claude-code']?.usd || 0) + (summary?.bySource['claude-p']?.usd || 0)
            const codexSpend =
              (summary?.bySource['codex-cli']?.usd || 0) + (summary?.bySource['codex-exec']?.usd || 0)
            return (
              <>
                <Card label={`Total · ${range}`} value={fmtUsd(totalUsd)} sub={`${totalRuns} runs`} accent />
                <Card label="Claude" value={fmtUsd(claudeSpend)} sub="" />
                <Card label="Codex" value={fmtUsd(codexSpend)} sub="" />
                <Card
                  label="Avg / run"
                  value={fmtUsd(totalRuns > 0 ? totalUsd / totalRuns : 0)}
                  sub={`${totalRuns} runs`}
                />
              </>
            )
          })()}
        </div>

        {/* Daily spend chart */}
        <section className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/40 p-3">
          <div className="mb-2 flex items-center justify-between text-[11px]">
            <span className="font-semibold uppercase tracking-wide text-zinc-500">Last 14 days</span>
            <span className="text-zinc-600">total: {fmtUsd(daily?.reduce((s, d) => s + d.usd, 0) || 0)}</span>
          </div>
          <div className="flex h-32 items-end gap-1">
            {(daily || []).slice().reverse().map((d) => {
              const h = Math.max(2, (d.usd / dailyMax) * 100)
              const claude = Object.entries(d.byModel)
                .filter(([m]) => familyOf(m) === 'claude')
                .reduce((s, [, v]) => s + v, 0)
              const codex = Object.entries(d.byModel)
                .filter(([m]) => familyOf(m) === 'codex')
                .reduce((s, [, v]) => s + v, 0)
              const claudeH = (claude / Math.max(d.usd, 0.001)) * h
              const codexH = (codex / Math.max(d.usd, 0.001)) * h
              return (
                <div key={d.date} className="flex flex-1 flex-col items-center justify-end" title={`${d.date} · ${fmtUsd(d.usd)} · ${d.runs} runs`}>
                  <div className="w-full overflow-hidden rounded-sm" style={{ height: `${h}%` }}>
                    {claudeH > 0 && (
                      <div className="w-full bg-[var(--gt-green)]" style={{ height: `${(claudeH / h) * 100}%` }} />
                    )}
                    {codexH > 0 && (
                      <div className="w-full bg-[var(--gt-yellow)]" style={{ height: `${(codexH / h) * 100}%` }} />
                    )}
                  </div>
                  <div className="mt-1 truncate text-[9px] tabular-nums text-zinc-600">
                    {d.date.slice(5)}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-end gap-3 text-[10px] text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[var(--gt-green)]" />
              Claude
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[var(--gt-yellow)]" />
              Codex
            </span>
          </div>
        </section>

        {/* By model */}
        <section className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/40 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">By model · {range}</div>
          <div className="space-y-1">
            {summary &&
              Object.entries(summary.byModel)
                .sort((a, b) => b[1].usd - a[1].usd)
                .map(([model, v]) => (
                  <div key={model} className="flex items-center gap-2 text-[11.5px]">
                    <EngineLogo engine={familyOf(model)} size={11} />
                    <span className="w-48 truncate font-mono text-zinc-300">{model}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/30">
                      <div
                        className="h-full bg-[var(--gt-accent-light)]"
                        style={{
                          width: `${Math.max(2, (v.usd / Math.max(1, summary.totalUsd)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums text-zinc-300">{fmtUsd(v.usd)}</span>
                    <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-zinc-600">
                      {v.runs}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-zinc-600">
                      {fmtNum(v.inputTokens)}in/{fmtNum(v.outputTokens)}out
                    </span>
                  </div>
                ))}
            {summary && Object.keys(summary.byModel).length === 0 && (
              <div className="text-[11px] text-zinc-600">No runs yet in this window.</div>
            )}
          </div>
        </section>

        {/* Per-agent ROI */}
        <section className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/40 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Per-agent · {range}</div>
          {byAgent && byAgent.length > 0 ? (
            <div className="space-y-0.5">
              <div className="grid grid-cols-12 gap-2 border-b border-[var(--gt-border)] pb-1 text-[9.5px] uppercase tracking-wide text-zinc-600">
                <div className="col-span-4">agent</div>
                <div className="col-span-1 text-right">runs</div>
                <div className="col-span-2 text-right">cost</div>
                <div className="col-span-1 text-right">PR</div>
                <div className="col-span-1 text-right">tick</div>
                <div className="col-span-1 text-right">none</div>
                <div className="col-span-2 text-right">$/run</div>
              </div>
              {byAgent.map((a) => (
                <div key={a.agentId} className="grid grid-cols-12 gap-2 py-1 text-[11.5px]">
                  <div className="col-span-4 truncate font-mono text-zinc-300">{a.agentId}</div>
                  <div className="col-span-1 text-right tabular-nums text-zinc-400">{a.runs}</div>
                  <div className="col-span-2 text-right tabular-nums text-zinc-200">{fmtUsd(a.usd)}</div>
                  <div className="col-span-1 text-right tabular-nums text-[var(--gt-green)]">{a.outcomes.prOpened || ''}</div>
                  <div className="col-span-1 text-right tabular-nums text-zinc-500">{a.outcomes.ticketFiled || ''}</div>
                  <div className="col-span-1 text-right tabular-nums text-zinc-700">{a.outcomes.none || ''}</div>
                  <div className="col-span-2 text-right tabular-nums text-zinc-500">
                    {fmtUsd(a.runs > 0 ? a.usd / a.runs : 0)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-zinc-600">No agent runs yet in this window.</div>
          )}
        </section>

        {/* Recent runs */}
        <section className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/40 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Recent runs {runs ? `· ${runs.length}` : ''}
          </div>
          {runs && runs.length > 0 ? (
            <div className="space-y-0.5">
              {runs.slice(0, 30).map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-[11px]">
                  <Badge tone={SOURCE_TONE[r.source] || 'mute'}>{r.source}</Badge>
                  <span className="w-32 truncate font-mono text-zinc-300">{r.model}</span>
                  <span className="w-32 truncate text-zinc-400">
                    {r.agentId || r.sessionId?.slice(0, 8) || '—'}
                  </span>
                  <span className="w-32 truncate text-zinc-600">
                    {r.repoRoot.split('/').pop()}
                  </span>
                  <div className="flex-1" />
                  <span className="w-16 text-right text-[10px] tabular-nums text-zinc-500">
                    {fmtNum(r.inputTokens)}/{fmtNum(r.outputTokens)}
                  </span>
                  <span className="w-12 text-right text-[10px] tabular-nums text-zinc-500">{fmtDur(r.durationMs)}</span>
                  <span className="w-16 text-right tabular-nums text-zinc-200">{fmtUsd(r.costUsd)}</span>
                  <span className="w-20 text-right text-[10px] tabular-nums text-zinc-600">{fmtWhen(r.startedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-zinc-600">No runs yet.</div>
          )}
        </section>
      </div>
    </div>
  )
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        accent ? 'border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/5' : 'border-[var(--gt-border)] bg-black/20'
      }`}
    >
      <div className="text-[9.5px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-[18px] font-bold tabular-nums ${accent ? 'text-zinc-100' : 'text-zinc-200'}`}>
        {value}
      </div>
      <div className="text-[10px] text-zinc-600">{sub}</div>
    </div>
  )
}

const tab: Tab = {
  id: 'observability',
  title: 'Spend',
  icon: DollarSign,
  order: 4.7,
  appliesTo: () => true, // global view across all repos
  badge: async (gt) => {
    try {
      const s = await gt.observability.summary('today')
      // Surface today's spend as a small dollar number when > $0.01
      const usd = Math.round(s.totalUsd * 100)
      return usd > 0 ? usd : 0 // shown as "N" in tab pill — represents cents today
    } catch {
      return 0
    }
  },
  Component: ObservabilityTab,
}
export default tab
