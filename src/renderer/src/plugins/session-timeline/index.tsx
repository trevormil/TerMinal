import { useState } from 'react'
import { History } from 'lucide-react'
import { TitledCard } from '../../components/ui/titled-card'
import { Empty } from '../../components/ui/display'
import { selectedTimelineTurn } from '../../lib/sessionTimeline'
import type { Plugin } from '../../lib/types'
import type { SessionTimeline } from '../../../../shared/types/session-timeline'

function Timeline({ data }: { data: SessionTimeline }) {
  const [line, setLine] = useState<number | null>(null)
  const turn = selectedTimelineTurn(data.turns, line)
  const index = turn ? data.turns.indexOf(turn) : 0
  return (
    <TitledCard icon={History} title="Session Timeline">
      {data.error ? (
        <Empty>{data.error}</Empty>
      ) : !turn ? (
        <Empty>No turns yet</Empty>
      ) : (
        <div className="space-y-2 text-[11px]">
          <label className="block text-muted-foreground">
            Jump to turn context · {index + 1} / {data.turns.length}
            <select
              aria-label="Session timeline turn"
              value={turn.line}
              onChange={(e) => setLine(Number(e.target.value))}
              className="mt-1 w-full rounded border bg-background p-1 text-foreground"
            >
              {data.turns.map((t, i) => (
                <option key={t.line} value={t.line}>
                  {i + 1}. {t.prompt.slice(0, 100)}
                </option>
              ))}
            </select>
          </label>
          <input
            type="range"
            aria-label="Scrub session turns"
            min={0}
            max={data.turns.length - 1}
            value={index}
            onChange={(e) => setLine(data.turns[Number(e.target.value)].line)}
            className="w-full accent-[var(--gt-accent)]"
          />
          <div className="flex justify-between text-muted-foreground">
            <span>Transcript line {turn.line}</span>
            <button type="button" onClick={() => setLine(null)} className="underline">
              Follow latest
            </button>
          </div>
          <section
            aria-label="Turn context"
            aria-live="polite"
            className="max-h-72 overflow-auto rounded border p-2"
            key={turn.line}
          >
            {turn.timestamp !== undefined && (
              <p className="mb-1 text-muted-foreground">
                {new Date(turn.timestamp).toLocaleString()}
              </p>
            )}
            <p className="font-semibold">You</p>
            <p className="whitespace-pre-wrap break-words">{turn.prompt}</p>
            <p className="mt-2 font-semibold">Assistant</p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">
              {turn.response || 'No assistant text recorded yet.'}
            </p>
          </section>
          <p className="text-muted-foreground">
            {data.truncated ? 'Showing the latest 500 turns. ' : ''}Text previews are limited to
            6,000 characters per prompt/response.
          </p>
        </div>
      )}
    </TitledCard>
  )
}

const plugin: Plugin<SessionTimeline> = {
  id: 'session-timeline',
  title: 'Session Timeline',
  icon: History,
  blurb: 'Scrub local session turns and jump to their prompt and response in the cockpit.',
  order: 3.6,
  intervalMs: 10_000,
  defaultEnabled: false,
  engines: ['claude', 'codex'],
  poll: (gt) => gt.sessionTimeline(),
  render: (data) =>
    data ? <Timeline key={data.sessionId} data={data} /> : <Empty>Loading timeline…</Empty>,
}
export default plugin
