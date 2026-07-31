import { useEffect, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { EngineLogo } from '../../components/EngineLogo'
import { ENGINE_IDS, ENGINE_MODELS, engineLabel } from '../../lib/engines'
import { MAX_BAKEOFF_ENTRANTS } from '../../../../shared/bakeoff'
import type { BakeOff, BakeOffEntrantSpec, Engine, Ticket } from '../../lib/types'

// Starting a bake-off spends real money on N parallel agent runs, so the fan-out
// is always explicit: you add each entrant by hand and see the count before you
// commit. There is no "run everything" button on purpose.

const MAX_ENTRANTS = MAX_BAKEOFF_ENTRANTS

function EntrantRow({
  spec,
  onChange,
  onRemove,
  removable,
}: {
  spec: BakeOffEntrantSpec
  onChange: (s: BakeOffEntrantSpec) => void
  onRemove: () => void
  removable: boolean
}) {
  const models = ENGINE_MODELS[spec.engine] ?? []
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-2">
      <EngineLogo engine={spec.engine} size={12} />
      <select
        value={spec.engine}
        onChange={(ev) => onChange({ engine: ev.target.value as Engine, model: undefined })}
        className="rounded border border-[var(--gt-border)] bg-black/30 px-1.5 py-1 text-[12px] text-zinc-200"
      >
        {ENGINE_IDS.map((id) => (
          <option key={id} value={id}>
            {engineLabel(id)}
          </option>
        ))}
      </select>
      <select
        value={spec.model || ''}
        onChange={(ev) => onChange({ ...spec, model: ev.target.value || undefined })}
        className="min-w-0 flex-1 rounded border border-[var(--gt-border)] bg-black/30 px-1.5 py-1 font-mono text-[11px] text-zinc-300"
      >
        <option value="">engine default</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </select>
      {removable && (
        <button
          onClick={onRemove}
          className="rounded p-1 text-zinc-600 hover:bg-white/10 hover:text-zinc-200"
          title="Remove entrant"
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

export function NewBakeOff({ onStarted }: { onStarted: (b: BakeOff) => void }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [slug, setSlug] = useState('')
  const [entrants, setEntrants] = useState<BakeOffEntrantSpec[]>([
    { engine: 'claude' },
    { engine: 'codex' },
  ])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [gateWarn, setGateWarn] = useState('')

  useEffect(() => {
    window.gt.tickets
      .list()
      .then((t) => setTickets(t.filter((x) => x.status === 'open' || x.status === 'in-progress')))
      .catch(() => setTickets([]))
    // Surface a budget WARN before N runs launch, not after.
    window.gt.budgets
      ?.gate?.()
      .then((g) => setGateWarn(g?.decision === 'warn' ? g.reason || '' : ''))
      .catch(() => undefined)
  }, [])

  const start = async () => {
    if (!slug) return
    setBusy(true)
    setErr('')
    try {
      const r = await window.gt.bakeoff.start(slug, entrants)
      if ('error' in r) setErr(r.error)
      else onStarted(r)
    } catch (e) {
      setErr((e as Error)?.message || 'the bake-off IPC is unavailable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl p-6">
      <h2 className="text-[15px] font-semibold text-zinc-100">New bake-off</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
        Run one ticket through several engines at once, each in its own isolated worktree and
        branch, then compare the diffs and pick the one you actually want. Every candidate opens its
        own PR — the winner still goes through review and the human merge gate.
      </p>

      <label className="mt-5 block">
        <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-zinc-500">
          Ticket
        </span>
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200"
        >
          <option value="">
            {tickets === null
              ? 'Loading tickets…'
              : `Select one of ${tickets.length} open tickets…`}
          </option>
          {(tickets || []).map((t) => (
            <option key={t.slug} value={t.slug}>
              #{t.id} · {t.title}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-5">
        <div className="mb-1 flex items-center">
          <span className="text-[10.5px] uppercase tracking-wide text-zinc-500">
            Entrants ({entrants.length})
          </span>
          <button
            onClick={() => setEntrants([...entrants, { engine: 'cursor' }])}
            disabled={entrants.length >= MAX_ENTRANTS}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200 disabled:opacity-40"
          >
            <Plus size={11} strokeWidth={2} /> Add
          </button>
        </div>
        <div className="space-y-1.5">
          {entrants.map((s, i) => (
            <EntrantRow
              key={i}
              spec={s}
              onChange={(n) => setEntrants(entrants.map((e, j) => (i === j ? n : e)))}
              onRemove={() => setEntrants(entrants.filter((_, j) => j !== i))}
              removable={entrants.length > 2}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">
          {entrants.length} parallel agent runs, capped at {MAX_ENTRANTS}. Subject to your daily
          budget cap.
        </p>
      </div>

      {gateWarn && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-300">
          Budget: {gateWarn}. This launches {entrants.length} runs at once.
        </div>
      )}

      {err && <div className="mt-4 text-[12px] text-amber-400">{err}</div>}

      <button
        onClick={start}
        disabled={!slug || busy}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-medium text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
        Start bake-off
      </button>
    </div>
  )
}
