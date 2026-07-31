import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Gavel,
  RefreshCw,
  Trash2,
  Trophy,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { Badge } from '../../components/ui'
import type { BadgeTone } from '../../components/ui'
import { DiffView } from '../../components/MrDetail'
import { EngineLogo } from '../../components/EngineLogo'
import { engineLabel } from '../../lib/engines'
import { navigateTo } from '../../lib/nav'
import type { BakeOff, BakeOffEntrant } from '../../lib/types'

// The comparison surface. The deliberate shape here: candidate STATS sit side by
// side (that's the part you actually scan across), while the PATCH is shown one
// candidate at a time behind a fast switcher. Three unified diffs crammed into
// three columns is unreadable at any realistic window width — the win is a
// single full-width diff you can flip between without losing your place.

const entrantTone = (s: BakeOffEntrant['status']): BadgeTone =>
  s === 'done' ? 'green' : s === 'running' ? 'blue' : s === 'pending' ? 'mute' : 'red'

const scoreColor = (n: number) =>
  n >= 8 ? 'text-emerald-400' : n >= 5 ? 'text-amber-400' : 'text-rose-400'

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full ${score >= 8 ? 'bg-emerald-400' : score >= 5 ? 'bg-amber-400' : 'bg-rose-400'}`}
        style={{ width: `${(Math.max(0, Math.min(10, score)) / 10) * 100}%` }}
      />
    </div>
  )
}

function CandidateCard({
  b,
  e,
  selected,
  onSelect,
  onPick,
  busy,
}: {
  b: BakeOff
  e: BakeOffEntrant
  selected: boolean
  onSelect: () => void
  onPick: () => void
  busy: boolean
}) {
  const judged = b.judge?.scores?.[e.id]
  const recommended = b.judge?.recommended === e.id
  const won = b.winner?.entrantId === e.id
  const decided = b.status === 'decided'

  return (
    <div
      className={`flex min-w-[220px] flex-1 flex-col rounded-xl border p-3 transition-colors ${
        won
          ? 'border-emerald-400/70 bg-emerald-400/10'
          : selected
            ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/10'
            : 'border-[var(--gt-border)] bg-[var(--gt-panel)] hover:border-[var(--gt-accent)]/50'
      }`}
    >
      <button onClick={onSelect} className="text-left">
        <div className="flex items-center gap-1.5">
          <EngineLogo engine={e.engine} size={12} />
          <span className="text-[12px] font-semibold text-zinc-100">{engineLabel(e.engine)}</span>
          {won && <Trophy size={12} strokeWidth={2} className="text-emerald-400" />}
          <span className="ml-auto">
            <Badge tone={entrantTone(e.status)}>{e.status}</Badge>
          </span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-zinc-500">
          {e.model || 'engine default'}
          {e.personaId ? ` · ${e.personaId}` : ''}
        </div>

        <div className="mt-2 flex items-baseline gap-2 font-mono text-[13px]">
          <span className="text-emerald-400">+{e.diff?.insertions ?? 0}</span>
          <span className="text-rose-400">−{e.diff?.deletions ?? 0}</span>
          <span className="text-[10.5px] text-zinc-500">
            {e.diff?.files ?? 0} file{(e.diff?.files ?? 0) === 1 ? '' : 's'}
          </span>
        </div>

        {judged ? (
          <div className="mt-2">
            <div className="flex items-center gap-1.5">
              <span className={`font-mono text-[13px] font-semibold ${scoreColor(judged.score)}`}>
                {judged.score}/10
              </span>
              {recommended && <Badge tone="accent">judge pick</Badge>}
            </div>
            <ScoreBar score={judged.score} />
            {judged.rationale && (
              <p className="mt-1 text-[11px] leading-snug text-zinc-400">{judged.rationale}</p>
            )}
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-zinc-600">Not judged yet.</div>
        )}

        {e.error && (
          <p className="mt-2 flex items-start gap-1 text-[11px] leading-snug text-amber-400">
            <AlertTriangle size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
            {e.error}
          </p>
        )}
      </button>

      <div className="mt-3 flex items-center gap-1.5">
        <button
          onClick={onPick}
          disabled={busy || decided || e.status !== 'done'}
          className={`rounded-md px-2 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
            recommended
              ? 'bg-[var(--gt-accent)] text-black hover:opacity-90'
              : 'border border-[var(--gt-border)] text-zinc-300 hover:bg-white/10'
          }`}
          title={decided ? 'This bake-off is already decided' : 'Declare this candidate the winner'}
        >
          {won ? 'Winner' : 'Pick this'}
        </button>
        {e.runId && (
          <button
            onClick={() => navigateTo('runs', { runId: e.runId })}
            className="inline-flex items-center gap-0.5 text-[11px] text-[var(--gt-accent-2)] hover:underline"
          >
            run <ArrowUpRight size={10} strokeWidth={2} />
          </button>
        )}
        {e.branch && (
          <span className="ml-auto truncate font-mono text-[10px] text-zinc-600" title={e.branch}>
            {e.branch}
          </span>
        )}
      </div>
    </div>
  )
}

export function Comparison({
  bakeOff,
  onChanged,
  onDeleted,
}: {
  bakeOff: BakeOff
  onChanged: (b: BakeOff) => void
  onDeleted: () => void
}) {
  const [sel, setSel] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const b = bakeOff
  const running = b.status === 'running'

  // Default to the judge's pick when there is one, else the first candidate
  // that actually produced a diff.
  const withDiff = useMemo(() => b.entrants.filter((e) => e.patch), [b.entrants])
  useEffect(() => {
    if (sel && b.entrants.some((e) => e.id === sel)) return
    setSel(b.winner?.entrantId || b.judge?.recommended || withDiff[0]?.id || '')
  }, [b.id, b.judge?.recommended, b.winner?.entrantId, withDiff, sel, b.entrants])

  const act = async (key: string, fn: () => Promise<BakeOff | { error: string } | null>) => {
    setBusy(key)
    setErr('')
    try {
      const r = await fn()
      if (!r) return
      if ('error' in r) setErr(r.error)
      else onChanged(r)
    } catch (e) {
      // Without this the spinner spins forever on a rejected invoke.
      setErr((e as Error)?.message || 'the bake-off IPC is unavailable')
    } finally {
      setBusy('')
    }
  }

  // Refresh is the ONLY path that re-diffs the entrant worktrees (3 git calls
  // each). It is user-initiated for exactly that reason.
  const refresh = () => act('refresh', () => window.gt.bakeoff.get(b.id, { withDiffs: true }))
  const judge = () => act('judge', () => window.gt.bakeoff.judge(b.id))
  const pick = (entrantId: string) => act('pick', () => window.gt.bakeoff.pick(b.id, entrantId))

  // A bake-off that is still spawning is worth polling — the candidate cards
  // fill in as each lane lands. STATUS ONLY: re-diffing four worktrees every
  // 10s would be 12 git subprocesses a tick on the main process.
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      window.gt.bakeoff
        .get(b.id)
        .then((r) => r && onChanged(r))
        .catch(() => undefined)
    }, 10_000)
    return () => clearInterval(t)
  }, [running, b.id, onChanged])

  const selected = b.entrants.find((e) => e.id === sel)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--gt-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-zinc-600">{b.ticket.ref}</span>
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-zinc-100">
            {b.ticket.title}
          </h2>
          <Badge
            tone={
              b.status === 'decided'
                ? 'green'
                : b.status === 'ready'
                  ? 'accent'
                  : b.status === 'failed'
                    ? 'red'
                    : 'blue'
            }
          >
            {b.status}
          </Badge>
          <button
            onClick={refresh}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            title="Re-read every candidate's worktree"
          >
            <RefreshCw
              size={12}
              strokeWidth={2}
              className={busy === 'refresh' ? 'animate-spin' : ''}
            />
          </button>
          <button
            onClick={judge}
            disabled={!!busy || withDiff.length < 2}
            className="flex items-center gap-1 rounded border border-[var(--gt-border)] px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              withDiff.length < 2
                ? 'Needs at least 2 candidate diffs'
                : 'Score the candidates with a blind LLM judge (advisory — you still pick)'
            }
          >
            {busy === 'judge' ? (
              <Loader2 size={12} strokeWidth={2} className="animate-spin" />
            ) : (
              <Gavel size={12} strokeWidth={2} />
            )}
            Judge
          </button>
          <button
            onClick={async () => {
              try {
                await window.gt.bakeoff.del(b.id)
              } catch {
                /* the record may already be gone; fall through to the list */
              }
              onDeleted()
            }}
            className="rounded px-1.5 py-0.5 text-zinc-600 hover:bg-white/10 hover:text-rose-400"
            title="Delete this bake-off record (worktrees, branches, and PRs are untouched)"
          >
            <Trash2 size={12} strokeWidth={2} />
          </button>
        </div>

        {err && <div className="mt-2 text-[11px] text-amber-400">{err}</div>}

        {b.judge?.error && (
          <div className="mt-2 text-[11px] text-amber-400">Judge failed: {b.judge.error}</div>
        )}
        {b.judge?.summary && (
          <p className="mt-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2 text-[11.5px] leading-snug text-zinc-300">
            <span className="text-zinc-500">
              Judge{b.judge.model ? ` (${b.judge.model})` : ''}:{' '}
            </span>
            {b.judge.summary}
          </p>
        )}
        {b.winner && (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-emerald-400">
            <Trophy size={12} strokeWidth={2} />
            You picked {b.winner.entrantId}
            {b.winner.agreedWithJudge === false && (
              <span className="text-zinc-500">— overruling the judge</span>
            )}
            . Its PR still goes through review and the human merge gate like any other.
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-2 overflow-x-auto px-4 py-3">
        {b.entrants.map((e) => (
          <CandidateCard
            key={e.id}
            b={b}
            e={e}
            selected={sel === e.id}
            onSelect={() => setSel(e.id)}
            onPick={() => pick(e.id)}
            busy={!!busy}
          />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--gt-border)]">
        <div className="flex shrink-0 items-center gap-1.5 px-4 py-1.5">
          <span className="text-[10.5px] uppercase tracking-wide text-zinc-500">Diff</span>
          {b.entrants.map((e) => (
            <button
              key={e.id}
              onClick={() => setSel(e.id)}
              disabled={!e.patch}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] disabled:opacity-30 ${
                sel === e.id
                  ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/15 text-zinc-100'
                  : 'border-[var(--gt-border)] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <EngineLogo engine={e.engine} size={10} />
              {e.id}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {selected?.patch ? (
            <DiffView
              key={`${b.id}-${selected.id}`}
              diff={selected.patch}
              scope={`bakeoff-${b.id}-${selected.id}`}
              iid={0}
              showViewed={false}
              allowStructural={false}
            />
          ) : (
            <div className="p-6 text-[12px] text-zinc-600">
              {running
                ? 'Candidates are still running — diffs appear as each lane commits.'
                : 'No diff for this candidate.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
