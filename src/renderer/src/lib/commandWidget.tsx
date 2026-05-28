import { SquareTerminal } from 'lucide-react'
import { Card, Row, Empty } from '../components/ui'
import type { CommandWidget, Plugin } from './types'

function renderOut(out: string | null, mode: CommandWidget['mode']) {
  if (out == null) return <Empty>…</Empty>
  if (out === '') return <Empty>(no output)</Empty>
  if (mode === 'big') {
    return <div className="text-2xl font-bold tabular-nums text-zinc-50">{out.split('\n')[0]}</div>
  }
  if (mode === 'kv') {
    return (
      <div>
        {out
          .split('\n')
          .slice(0, 8)
          .map((line, i) => {
            const idx = line.indexOf(':')
            return idx < 0 ? (
              <Row key={i} label="" value={line} />
            ) : (
              <Row key={i} label={line.slice(0, idx).trim()} value={line.slice(idx + 1).trim()} />
            )
          })}
      </div>
    )
  }
  return (
    <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-snug text-zinc-300">
      {out}
    </pre>
  )
}

/** Wrap a declarative command widget as a regular Plugin. */
export function commandWidgetToPlugin(w: CommandWidget): Plugin {
  return {
    id: w.id,
    title: w.title,
    icon: SquareTerminal,
    blurb: `$ ${w.command}`,
    order: 50,
    intervalMs: w.intervalMs,
    defaultEnabled: true,
    poll: async (gt) => {
      const r = await gt.runCommand(w.command)
      return r.stdout || (r.ok ? '' : `exit ${r.code}`)
    },
    render: (out) => (
      <Card
        icon={SquareTerminal}
        title={w.title}
        right={<span className="text-[9px] uppercase tracking-wide text-zinc-600">{w.source}</span>}
      >
        {renderOut(out as string | null, w.mode)}
      </Card>
    ),
  }
}
