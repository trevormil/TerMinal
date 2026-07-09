import type { CSSProperties } from 'react'
import { Repeat, Play, RefreshCw, Square, Users } from 'lucide-react'
import { Card, Row, Badge, Empty } from '../../components/ui'
import { navigateTo } from '../../lib/nav'
import type { Plugin, LoopRecord, LoopState } from '../../lib/types'

type LoopData = { loop: LoopRecord | null; state: LoopState | null }

const phaseTone = (p: string): 'ok' | 'warn' | 'bad' | 'mute' =>
  p === 'done' ? 'ok' : p === 'stopped' ? 'bad' : p === 'evaluate' || p === 'decide' ? 'warn' : 'mute'

async function act(fn: 'step' | 'restart' | 'stop', id: string): Promise<void> {
  try {
    await window.gt.loops[fn](id)
  } catch {
    /* surfaced in the next poll */
  }
}

async function newLoop(): Promise<void> {
  const goal = window.prompt('New loop — what should it converge on?')?.trim()
  if (!goal) return
  const r = await window.gt.loops.create({ goal })
  if (r && 'error' in r) window.alert(`Loop: ${r.error}`)
}

const btn: CSSProperties = {
  flex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontSize: 11,
  padding: '6px 8px',
  borderRadius: 7,
  cursor: 'pointer',
  border: '1px solid var(--line, #232a33)',
  background: 'transparent',
  color: 'inherit',
}

const plugin: Plugin<LoopData> = {
  id: 'loop',
  title: 'Loop',
  icon: Repeat,
  blurb: 'Active loop: phase, iteration, contract progress, and taste score. Step / restart / stop.',
  order: 5,
  intervalMs: 2500,
  defaultEnabled: true,
  poll: async (gt): Promise<LoopData> => {
    const loops = await gt.loops.list().catch(() => [] as LoopRecord[])
    const active =
      loops.find((l) => l.status !== 'stopped' && l.phase !== 'done') || loops[0] || null
    if (!active) return { loop: null, state: null }
    const st = await gt.loops.state(active.id).catch(() => null)
    return { loop: active, state: st && !('error' in st) ? (st as LoopState) : null }
  },
  render: (d) => {
    if (!d?.loop)
      return (
        <Card icon={Repeat} title="Loop">
          <Empty>No active loop</Empty>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={() => void newLoop()} style={btn}>
              <Play size={11} /> New loop
            </button>
            <button onClick={() => navigateTo('paired-loop:new')} style={btn}>
              <Users size={11} /> New paired loop
            </button>
          </div>
        </Card>
      )
    const { loop, state } = d
    const a = state?.assertions
    const running = loop.status === 'running'
    const paired = loop.mode === 'paired'
    return (
      <Card
        icon={Repeat}
        title="Loop"
        right={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {paired && <Badge tone="mute">paired</Badge>}
            <Badge tone={phaseTone(loop.phase)}>
              {running ? `${loop.activeRole ?? 'run'}…` : loop.phase}
            </Badge>
          </span>
        }
      >
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted, #8b949e)',
            marginBottom: 6,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={loop.goal}
        >
          {loop.goal}
        </div>
        <Row label="iteration" value={String(loop.iteration)} />
        <Row
          label="assertions"
          value={a ? `${a.pass}/${a.total} pass${a.fail ? ` · ${a.fail} fail` : ''}` : '—'}
        />
        <Row label="bottleneck" value={state?.bottleneck || '—'} />
        <Row label="taste" value={state?.lastScore || '—'} />
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {!paired && (
            <button onClick={() => act('step', loop.id)} disabled={running} style={btn}>
              <Play size={11} /> Step
            </button>
          )}
          <button onClick={() => act('restart', loop.id)} style={btn}>
            <RefreshCw size={11} /> Restart
          </button>
          <button onClick={() => act('stop', loop.id)} style={btn}>
            <Square size={11} /> Stop
          </button>
        </div>
      </Card>
    )
  },
}
export default plugin
