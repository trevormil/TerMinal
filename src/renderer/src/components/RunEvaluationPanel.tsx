import { Badge } from './ui'
import { statusTone } from '../lib/badges'
import type { AgentRunEvaluation } from '../lib/types'

function fmtWhen(ts: number): string {
  if (!ts) return 'unknown'
  const s = (Date.now() - ts) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function RunEvaluationPanel({
  evaluation,
  compact = false,
}: {
  evaluation: AgentRunEvaluation
  compact?: boolean
}) {
  if (compact) {
    return (
      <div className="border-b border-[var(--gt-border)]/60 bg-black/15 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Evaluation
          </span>
          <Badge tone={statusTone(evaluation.status)}>{evaluation.status}</Badge>
          <span className="min-w-0 truncate text-[11px] text-zinc-400">{evaluation.summary}</span>
        </div>
        {evaluation.checks.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {evaluation.checks.map((check) => (
              <span
                key={check.id}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--gt-border)]/70 px-1.5 py-0.5 text-[10px] text-zinc-500"
              >
                <Badge tone={statusTone(check.status)}>{check.status}</Badge>
                <span className="truncate">{check.title}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={statusTone(evaluation.status)}>{evaluation.status}</Badge>
        <span className="text-[11.5px] text-zinc-300">{evaluation.summary}</span>
        <span className="ml-auto text-[10.5px] text-zinc-600">
          evaluated {fmtWhen(evaluation.evaluatedAt)}
        </span>
      </div>
      {evaluation.checks.length > 0 && (
        <div className="space-y-1">
          {evaluation.checks.map((check) => (
            <div key={check.id} className="flex min-w-0 items-start gap-2 text-[11px]">
              <Badge tone={statusTone(check.status)}>{check.status}</Badge>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-zinc-300">{check.title}</span>
                {check.required && <span className="ml-1 text-zinc-600">Required</span>}
                {check.command && (
                  <span className="ml-2 font-mono text-[10.5px] text-zinc-500">
                    {check.command}
                  </span>
                )}
                {check.detail && (
                  <span className="mt-0.5 block truncate text-[10.5px] text-zinc-600">
                    {check.detail}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {evaluation.judge && (
        <div className="mt-2 text-[10.5px] text-zinc-600">
          Judge: {evaluation.judge.status} · {evaluation.judge.detail}
        </div>
      )}
    </div>
  )
}
