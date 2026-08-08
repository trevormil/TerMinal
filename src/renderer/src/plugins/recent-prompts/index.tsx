import { History } from 'lucide-react'
import { Card, CopyButton, Empty } from '../../components/ui'
import { relativeTime } from '../../lib/time'
import type { Plugin, TranscriptStats } from '../../lib/types'

// The prompts YOU typed this session, newest first — the thing you reach for
// when re-steering an agent ("what did I ask it to do again?") or reusing a
// prompt you already tuned. Click one to copy it; the cockpit never types into
// a live session (same rule as the search tab's snippet results), because
// injecting text mid-turn is how a prompt lands inside someone else's answer.
const SHOWN = 6

const plugin: Plugin<TranscriptStats> = {
  id: 'recent-prompts',
  title: 'Recent Prompts',
  icon: History,
  blurb: 'The prompts you typed this session, newest first. Click one to copy it.',
  order: 3.5,
  intervalMs: 3000,
  realtime: true,
  defaultEnabled: true,
  engines: ['claude'],
  poll: (gt) => gt.transcript(),
  render: (d) => {
    // Newest first, and the array is shared with the poll cache — copy before
    // reversing so the next render doesn't get a re-reversed list.
    const prompts = [...(d?.recentPrompts ?? [])].reverse().slice(0, SHOWN)
    return (
      <Card icon={History} title="Recent Prompts">
        {prompts.length === 0 ? (
          <Empty>No prompts yet</Empty>
        ) : (
          <div className="space-y-1">
            {prompts.map((p) => (
              <CopyButton
                key={`${p.ts}:${p.text.slice(0, 40)}`}
                value={p.text}
                title="Copy prompt"
                className="w-full items-start !gap-1.5 text-left"
              >
                <span
                  className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-400"
                  title={p.text}
                >
                  {p.text}
                </span>
                {p.ts > 0 && (
                  <span className="shrink-0 pt-px text-[9px] tabular-nums text-zinc-600">
                    {relativeTime(p.ts)}
                  </span>
                )}
              </CopyButton>
            ))}
          </div>
        )}
      </Card>
    )
  },
}
export default plugin
