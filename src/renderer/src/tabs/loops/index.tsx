import { useEffect, useMemo, useState } from 'react'
import { Repeat, FileText, TrendingDown } from 'lucide-react'
import { Badge, type BadgeTone } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { Sparkline } from './Sparkline'
import type { Tab, TabContext, LoopRecord, LoopHistory } from '../../lib/types'

// Loops persist a full audit trail under <repo>/.TerMinal/loops/<id>/, but until
// now the only UI for it lived in the live session — so a loop became invisible
// the moment its session closed. This tab is strictly read-only: it renders what
// is already on disk and never steps, restarts or stops a loop. Driving a loop
// stays in the session that owns it.

const statusTone = (s: string): BadgeTone =>
  s === 'done'
    ? 'green'
    : s === 'running'
      ? 'blue'
      : s === 'blocked'
        ? 'red'
        : s === 'stopped'
          ? 'yellow'
          : 'mute'

const roleTone = (r: string): BadgeTone =>
  r === 'planner' ? 'accent' : r === 'evaluator' ? 'yellow' : 'blue'

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`)

const fmtWhen = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

function LoopDetail({ loop }: { loop: LoopRecord }) {
  const [hist, setHist] = useState<LoopHistory | null>(null)
  const [err, setErr] = useState('')
  const [turn, setTurn] = useState<{ file: string; body: string } | null>(null)

  useEffect(() => {
    let live = true
    setHist(null)
    setErr('')
    setTurn(null)
    void window.gt.loops
      .history(loop.id)
      .then((h) => {
        if (!live) return
        if ('error' in h) setErr(h.error)
        else setHist(h)
      })
      .catch(() => live && setErr('could not read loop state'))
    return () => {
      live = false
    }
  }, [loop.id])

  const scored = useMemo(
    () => (hist?.scores || []).filter((s) => s.weighted !== null),
    [hist?.scores],
  )

  if (err)
    return <div className="p-5 text-[12px] text-zinc-500">Could not read this loop: {err}</div>
  if (!hist) return <div className="p-5 text-[12px] text-zinc-600">Reading loop state…</div>

  const a = hist.assertions

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(loop.status)}>{loop.status}</Badge>
        <Badge tone="mute">{loop.mode}</Badge>
        <Badge tone="mute">{loop.engine}</Badge>
        <span className="text-[11px] text-zinc-600">
          iteration {loop.iteration}/{loop.maxIterations} · {loop.repo}
        </span>
      </div>
      <h2 className="mb-1 text-[15px] font-semibold text-zinc-100">{loop.goal}</h2>
      <div className="mb-4 font-mono text-[10.5px] text-zinc-600">
        {loop.branch} · updated {fmtWhen(loop.updatedAt)}
      </div>

      {a.total > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-[10.5px] uppercase tracking-wider text-zinc-600">contract</span>
          <Badge tone="green">{a.pass} pass</Badge>
          <Badge tone={a.fail > 0 ? 'red' : 'mute'}>{a.fail} fail</Badge>
          <Badge tone="mute">{a.todo} todo</Badge>
          <span className="text-zinc-600">of {a.total}</span>
        </div>
      )}

      {scored.length > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
          <div className="mb-2 text-[10.5px] uppercase tracking-wider text-zinc-600">
            taste score · {scored.length} scored turn{scored.length === 1 ? '' : 's'}
          </div>
          <Sparkline
            values={scored.map((s) => s.weighted as number)}
            labels={scored.map((s) => `turn ${s.iteration}`)}
          />
          {hist.plateau.plateaued && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--gt-yellow)]/40 bg-[var(--gt-yellow)]/10 px-2.5 py-2 text-[11px] text-[var(--gt-yellow)]">
              <TrendingDown size={13} strokeWidth={2} className="mt-px shrink-0" />
              {/* The engine only terminates on allPass && plateau (loop-decide.ts),
                  so a stall while assertions still fail is the loop correctly
                  working the contract — reporting it must not read as "stop". */}
              <span>
                Taste has stalled — {hist.plateau.sinceImprovement} scored turns since the best
                score ({hist.plateau.best}).{' '}
                {a.fail > 0
                  ? `${a.fail} assertion${a.fail === 1 ? '' : 's'} still failing, so the loop is right to keep going; the score is just not the thing moving.`
                  : 'The contract is met, so further turns are likely to burn budget without moving the score — consider stopping and re-planning the contract.'}
              </span>
            </div>
          )}
        </div>
      )}

      {hist.turns.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[10.5px] uppercase tracking-wider text-zinc-600">
            turns · {hist.turns.length}
          </div>
          <div className="divide-y divide-[var(--gt-border)] rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]">
            {hist.turns.map((t) => (
              <button
                key={t.file}
                onClick={async () => {
                  try {
                    const body = await window.gt.loops.turnLog(loop.id, t.file)
                    setTurn({ file: t.file, body: typeof body === 'string' ? body : body.error })
                  } catch {
                    setTurn({ file: t.file, body: 'could not read this turn log' })
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-white/5"
              >
                <span className="w-8 shrink-0 font-mono text-zinc-600">{t.iteration}</span>
                <Badge tone={roleTone(t.role)}>{t.role || 'turn'}</Badge>
                <span className="truncate font-mono text-[10.5px] text-zinc-500">{t.runId}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600">
                  {fmtBytes(t.bytes)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {turn && (
        <div className="mb-4 rounded-lg border border-[var(--gt-border)] bg-black/30">
          <div className="flex items-center gap-2 border-b border-[var(--gt-border)] px-3 py-1.5">
            <FileText size={12} strokeWidth={2} className="text-zinc-600" />
            <span className="font-mono text-[10.5px] text-zinc-400">{turn.file}</span>
            <button
              onClick={() => setTurn(null)}
              className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-200"
            >
              close
            </button>
          </div>
          <pre className="max-h-[420px] overflow-auto px-3 py-2 font-mono text-[10.5px] leading-relaxed text-zinc-400">
            {turn.body}
          </pre>
        </div>
      )}

      {hist.contract && (
        <div className="mb-4">
          <div className="mb-2 text-[10.5px] uppercase tracking-wider text-zinc-600">contract</div>
          <div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] px-3 py-2">
            <Markdown>{hist.contract}</Markdown>
          </div>
        </div>
      )}

      {hist.log && (
        <div>
          <div className="mb-2 text-[10.5px] uppercase tracking-wider text-zinc-600">log</div>
          <pre className="max-h-[280px] overflow-auto rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-zinc-500">
            {hist.log.trim()}
          </pre>
        </div>
      )}
    </div>
  )
}

function LoopsTab({ ctx }: { ctx: TabContext }) {
  const [loops, setLoops] = useState<LoopRecord[]>([])
  const [sel, setSel] = useState('')

  useEffect(() => {
    let live = true
    const load = () =>
      void window.gt.loops
        .list()
        .then((l) => live && setLoops(Array.isArray(l) ? l : []))
        .catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])

  // Loops are recorded globally; scope the list to the attached repo so the tab
  // matches the rest of the workspace.
  const mine = useMemo(
    () => loops.filter((l) => !ctx.repoRoot || l.repoRoot === ctx.repoRoot),
    [loops, ctx.repoRoot],
  )
  const selected = mine.find((l) => l.id === sel) || null

  return (
    <div className="flex h-full min-h-0 bg-[var(--gt-bg)]">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-[var(--gt-border)]">
        <div className="shrink-0 border-b border-[var(--gt-border)] px-3 py-2 text-[11px] text-zinc-500">
          Loops · {mine.length}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mine.length === 0 && (
            <div className="p-4 text-[11.5px] leading-relaxed text-zinc-600">
              No loops recorded for this repo yet. Start one with{' '}
              <code className="font-mono text-zinc-400">/loop-driver</code> — it will show up here
              and stay inspectable after the session closes.
            </div>
          )}
          {mine.map((l) => (
            <button
              key={l.id}
              onClick={() => setSel(l.id)}
              className={`flex w-full flex-col gap-1 border-b border-[var(--gt-border)]/60 px-3 py-2 text-left hover:bg-white/5 ${
                l.id === sel ? 'bg-[var(--gt-accent)]/10' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                <span className="ml-auto font-mono text-[10px] text-zinc-600">
                  {l.iteration}/{l.maxIterations}
                </span>
              </div>
              <div className="truncate text-[12px] text-zinc-200">{l.goal}</div>
              <div className="truncate font-mono text-[10px] text-zinc-600">
                {fmtWhen(l.updatedAt)}
              </div>
            </button>
          ))}
        </div>
      </div>
      {selected ? (
        <LoopDetail key={selected.id} loop={selected} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-zinc-600">
          Select a loop to inspect its contract, turns, and taste trend.
        </div>
      )}
    </div>
  )
}

const tab: Tab = {
  id: 'loops',
  title: 'Loops',
  icon: Repeat,
  // Between Runs (3.45) and Schedules (3.5) — it belongs with the other
  // "what did the machine do" surfaces.
  order: 3.47,
  appliesTo: (ctx) => !!ctx.repoRoot,
  Component: LoopsTab,
}
export default tab
