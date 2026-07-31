import { useCallback, useEffect, useState } from 'react'
import { Swords, Plus, Trophy } from 'lucide-react'
import { Badge } from '../../components/ui'
import { EngineLogo } from '../../components/EngineLogo'
import { SkillHint } from '../../components/SkillHint'
import { Comparison } from './Comparison'
import { NewBakeOff } from './NewBakeOff'
import { capabilityMissing, probeCapability } from '../../lib/capability'
import type { BakeOff, Tab, TabContext } from '../../lib/types'

const CAP = 'bakeoff'
// Kick the probe at module load so `appliesTo` has an answer before the tab bar
// settles. The tab folder auto-registers via import.meta.glob, but the main
// handlers are wired by hand in index.ts — until they are, every invoke rejects.
probeCapability(CAP, () => window.gt.bakeoff.pendingCount())

// Bake-off gets its own tab rather than living inside Runs or Tickets: it is a
// WORKFLOW (choose entrants → watch → compare → decide), not another list of
// runs, and its comparison screen wants the full window. Runs still shows each
// candidate individually — this tab is the only place they're seen together.

function reldate(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function BakeOffTab({ ctx }: { ctx: TabContext }) {
  const [list, setList] = useState<BakeOff[] | null>(null)
  const [selId, setSelId] = useState('')
  const [sel, setSel] = useState<BakeOff | null>(null)
  const [creating, setCreating] = useState(false)
  const [fatal, setFatal] = useState('')

  const load = useCallback(
    () =>
      window.gt.bakeoff
        .list()
        .then((r) => {
          setList(r)
          setFatal('')
        })
        // A rejected invoke must resolve the "Loading…" state, not hang on it.
        .catch((e: Error) => {
          setList([])
          setFatal(e?.message || 'bake-off IPC is unavailable')
        }),
    [ctx.repoRoot],
  )
  useEffect(() => {
    load()
  }, [load])

  // Opening a bake-off syncs its run statuses. Diffs are NOT re-read here —
  // that is the Refresh button's job (12 git spawns is not a page-open cost).
  useEffect(() => {
    if (!selId) {
      setSel(null)
      return
    }
    window.gt.bakeoff
      .get(selId)
      .then(setSel)
      .catch(() => setSel(null))
  }, [selId])

  if (fatal)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--gt-bg)] p-8 text-center">
        <Swords size={20} strokeWidth={2} className="text-zinc-600" />
        <p className="text-[12.5px] text-zinc-300">Bake-off is not available in this build.</p>
        <p className="max-w-md text-[11px] leading-relaxed text-zinc-600">
          The renderer tab shipped but its main-process handlers are not registered (
          <code className="font-mono">registerBakeOffIpc</code> in{' '}
          <code className="font-mono">src/main/index.ts</code>).
        </p>
        <p className="font-mono text-[10.5px] text-zinc-700">{fatal}</p>
      </div>
    )

  const onChanged = useCallback((b: BakeOff) => {
    setSel(b)
    setList((prev) => (prev || []).map((x) => (x.id === b.id ? b : x)))
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-2">
        <Swords size={14} strokeWidth={2} className="text-zinc-400" />
        <span className="text-[12px] font-semibold text-zinc-200">
          Bake-offs {list ? `(${list.length})` : ''}
        </span>
        <button
          onClick={() => {
            setCreating(true)
            setSelId('')
          }}
          className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--gt-border)] px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-white/10"
        >
          <Plus size={11} strokeWidth={2} /> New bake-off
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[280px] shrink-0 overflow-y-auto border-r border-[var(--gt-border)]">
          <div className="border-b border-[var(--gt-border)] p-2">
            <SkillHint>
              Same ticket, several engines, parallel worktrees. Compare the diffs, let a blind judge
              score them, then pick the one you want to keep.
            </SkillHint>
          </div>
          {list === null ? (
            <div className="p-6 text-[12px] text-zinc-600">Loading…</div>
          ) : list.length === 0 ? (
            <div className="p-6 text-[12px] leading-relaxed text-zinc-600">
              No bake-offs yet for this repo.
            </div>
          ) : (
            list.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setCreating(false)
                  setSelId(b.id)
                }}
                className={`block w-full border-b border-[var(--gt-border)]/60 px-3 py-2.5 text-left hover:bg-white/5 ${
                  selId === b.id ? 'bg-white/5' : ''
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-zinc-600">{b.ticket.ref}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-200">
                    {b.ticket.title}
                  </span>
                  {b.status === 'decided' && (
                    <Trophy size={11} strokeWidth={2} className="shrink-0 text-emerald-400" />
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-600">
                  {b.entrants.map((e) => (
                    <EngineLogo key={e.id} engine={e.engine} size={11} />
                  ))}
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
                  <span className="ml-auto">{reldate(b.createdAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-hidden">
          {creating ? (
            <NewBakeOff
              onStarted={(b) => {
                setCreating(false)
                setList((prev) => [b, ...(prev || [])])
                setSelId(b.id)
              }}
            />
          ) : sel ? (
            <Comparison
              bakeOff={sel}
              onChanged={onChanged}
              onDeleted={() => {
                setSelId('')
                load()
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-600">
              Select a bake-off, or start a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'bakeoff',
  title: 'Bake-off',
  icon: Swords,
  // Sits with the other run-shaped surfaces: Runs (3.45) → Bake-off (3.46) →
  // Schedules (3.5).
  order: 3.46,
  // Hidden entirely once the probe confirms the IPC is absent, so a
  // half-landed feature never puts a dead tab in the tab bar.
  appliesTo: (ctx) => !!ctx.repoRoot && !capabilityMissing(CAP),
  badge: (gt) => gt.bakeoff.pendingCount().catch(() => 0),
  Component: BakeOffTab,
}
export default tab
