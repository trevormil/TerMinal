import { useEffect, useState } from 'react'
import { CheckCircle2, CircleDashed, ExternalLink, MinusCircle, XCircle } from 'lucide-react'
import { usePolled } from '../../lib/usePolled'
import { Empty } from '../../components/ui'
import type { PrCheckRun, PrChecksSummary } from '../../lib/types'

// The PR's CI, GitHub-native: check runs and legacy commit statuses on the head
// sha, failures first. Off GitHub the panel says so in one line rather than
// rendering an empty list that reads as a broken fetch.

/** ms → the shortest honest reading. Durations here are seconds to minutes. */
function fmtDuration(ms: number | null): string {
  if (ms == null || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

type Tone = 'pass' | 'fail' | 'pending' | 'other'

function toneOf(r: PrCheckRun): Tone {
  if (
    ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(
      r.conclusion,
    )
  )
    return 'fail'
  if (r.status !== 'completed') return 'pending'
  return r.conclusion === 'success' ? 'pass' : 'other'
}

const TONE_COLOR: Record<Tone, string> = {
  pass: 'var(--gt-green)',
  fail: 'var(--gt-red)',
  pending: 'var(--gt-text-muted)',
  other: 'var(--gt-text-faint)',
}

function ToneIcon({ tone }: { tone: Tone }) {
  const props = { size: 13, strokeWidth: 2, style: { color: TONE_COLOR[tone] } } as const
  if (tone === 'fail') return <XCircle {...props} />
  if (tone === 'pass') return <CheckCircle2 {...props} />
  if (tone === 'pending') return <CircleDashed {...props} className="animate-pulse" />
  return <MinusCircle {...props} />
}

/** The one-line roll-up: `2 failed · 1 running · 5 passed`. */
export function ChecksSummaryLine({ summary }: { summary: PrChecksSummary }) {
  if (!summary.total) return null
  const parts: { n: number; label: string; color: string }[] = [
    { n: summary.failed, label: 'failed', color: TONE_COLOR.fail },
    { n: summary.pending, label: 'running', color: TONE_COLOR.pending },
    { n: summary.passed, label: 'passed', color: TONE_COLOR.pass },
    { n: summary.other, label: 'skipped', color: TONE_COLOR.other },
  ].filter((p) => p.n > 0) // absent, not zero (design-system.md §6)
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      {parts.map((p) => (
        <span key={p.label} className="tabular-nums" style={{ color: p.color }}>
          {p.n} {p.label}
        </span>
      ))}
    </span>
  )
}

function CheckRow({ run }: { run: PrCheckRun }) {
  const tone = toneOf(run)
  const duration = fmtDuration(run.durationMs)
  const label = run.conclusion || run.status.replace('_', ' ')
  return (
    <div className="flex items-center gap-2 border-b border-[var(--gt-border)]/50 px-3 py-1.5 last:border-b-0">
      <ToneIcon tone={tone} />
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--gt-text-soft)]">
        {run.name || 'Unnamed check'}
      </span>
      <span className="shrink-0 text-[11px]" style={{ color: TONE_COLOR[tone] }}>
        {label}
      </span>
      {duration && (
        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-[var(--gt-text-faint)]">
          {duration}
        </span>
      )}
      {run.detailsUrl ? (
        <button
          type="button"
          // The existing safe-open path: main decides what a URL is allowed to do.
          onClick={() => window.gt.openExternal(run.detailsUrl)}
          title="Open this check on GitHub"
          className="shrink-0 rounded p-1 text-[var(--gt-text-faint)] hover:bg-white/5 hover:text-[var(--gt-text-soft)]"
          aria-label={`Open ${run.name} details`}
        >
          <ExternalLink size={12} strokeWidth={2} />
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
    </div>
  )
}

export function ChecksPanel({ repoRoot, iid }: { repoRoot: string; iid: number }) {
  // Poll only while something is still running — a settled PR's checks never
  // change, and `intervalMs <= 0` is usePolled's one-shot mode.
  const [pending, setPending] = useState(true)
  const { data, error, loading } = usePolled(() => window.gt.githubReview.checks(repoRoot, iid), {
    intervalMs: pending ? 12_000 : 0,
    deps: [repoRoot, iid, pending],
    enabled: !!repoRoot,
  })

  useEffect(() => {
    if (data?.supported) setPending(data.summary.state === 'pending')
  }, [data])

  if (!repoRoot) return <Empty>Checks need a local repo.</Empty>
  if (loading && !data) return <Empty>Loading checks…</Empty>
  if (error) return <Empty>Could not load checks from gh.</Empty>
  if (!data) return <Empty>No checks.</Empty>
  if (!data.supported) return <Empty>{data.reason}.</Empty>
  if (!data.runs.length) return <Empty>No checks have run on this head.</Empty>

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
        <ChecksSummaryLine summary={data.summary} />
        {data.sha && (
          <span className="ml-auto font-mono text-[10.5px] text-[var(--gt-text-faint)]">
            {data.sha.slice(0, 7)}
          </span>
        )}
      </div>
      <div>
        {data.runs.map((r) => (
          <CheckRow key={r.id} run={r} />
        ))}
      </div>
    </div>
  )
}
