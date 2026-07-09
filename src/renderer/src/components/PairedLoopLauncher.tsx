import { useState } from 'react'
import { Repeat, X, ArrowRight } from 'lucide-react'
import { ENGINE_MODELS, ENGINE_LABEL } from '../lib/engines'

// Live-paired loop launcher (see .claude/skills/loop). Collects a goal plus an
// independent engine/model for each of the two live sessions — a WORKER
// (generator, in the loop worktree) and a DRIVER (operator/evaluator, in the
// main repo) — then hands the config to App.startPairedLoop, which creates the
// loop + spawns the two linked sessions side by side.

// Loop roles run interactive skill-driven agents, so only the three skill-capable
// engines are offered (openrouter is Process-only; local is not an agent).
type LoopEngine = 'claude' | 'codex' | 'cursor'
const LOOP_ENGINES: LoopEngine[] = ['claude', 'codex', 'cursor']

export type PairedLoopConfig = {
  goal: string
  repoRoot: string
  driver: { engine: LoopEngine; model?: string }
  worker: { engine: LoopEngine; model?: string }
}

function RolePicker({
  label,
  hint,
  engine,
  model,
  onEngine,
  onModel,
}: {
  label: string
  hint: string
  engine: LoopEngine
  model: string
  onEngine: (e: LoopEngine) => void
  onModel: (m: string) => void
}) {
  return (
    <div className="flex-1 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
      <div className="mb-1 text-[12px] font-semibold text-zinc-200">{label}</div>
      <div className="mb-2 text-[11px] text-zinc-500">{hint}</div>
      <div className="mb-2 flex gap-1">
        {LOOP_ENGINES.map((e) => (
          <button
            key={e}
            onClick={() => {
              onEngine(e)
              onModel('') // reset model to engine default when engine changes
            }}
            className={`flex-1 rounded px-2 py-1 text-[11px] ${
              engine === e ? 'bg-white/15 text-zinc-100' : 'text-zinc-400 hover:bg-white/10'
            }`}
          >
            {ENGINE_LABEL[e]}
          </button>
        ))}
      </div>
      <select
        value={model}
        onChange={(e) => onModel(e.target.value)}
        className="w-full rounded border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-200"
      >
        <option value="">Default model</option>
        {ENGINE_MODELS[engine].map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function PairedLoopLauncher({
  repoRoot,
  onLaunch,
  onClose,
}: {
  repoRoot: string
  onLaunch: (cfg: PairedLoopConfig) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}) {
  const [goal, setGoal] = useState('')
  const [driverEngine, setDriverEngine] = useState<LoopEngine>('claude')
  const [driverModel, setDriverModel] = useState('')
  const [workerEngine, setWorkerEngine] = useState<LoopEngine>('claude')
  const [workerModel, setWorkerModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const repoLabel = repoRoot.replace(/\/$/, '').split('/').pop() || repoRoot

  const launch = async () => {
    const g = goal.trim()
    if (!g || busy) return
    setBusy(true)
    setError('')
    const res = await onLaunch({
      goal: g,
      repoRoot,
      driver: { engine: driverEngine, model: driverModel || undefined },
      worker: { engine: workerEngine, model: workerModel || undefined },
    })
    if (res.ok) onClose()
    else {
      setError(res.error || 'Could not start the paired loop.')
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[92vw] rounded-xl border border-[var(--gt-border)] bg-[var(--gt-bg)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <Repeat size={15} strokeWidth={2} className="text-zinc-300" />
          <span className="text-[13px] font-semibold text-zinc-100">Start a paired loop</span>
          <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200" title="Close">
            <X size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="mb-3 text-[11px] text-zinc-500">
          Two linked sessions in <span className="text-zinc-300">{repoLabel}</span> — a worker writes
          code in an isolated worktree, a driver negotiates the contract and grades it. Opened side by
          side, contract-first.
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          Goal
        </label>
        <textarea
          autoFocus
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void launch()
          }}
          placeholder="What should this loop converge on? (the driver turns this into a gradable contract)"
          rows={3}
          className="mb-3 w-full resize-none rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12px] text-zinc-100 placeholder:text-zinc-600"
        />

        <div className="mb-3 flex gap-3">
          <RolePicker
            label="Worker"
            hint="generator · writes code in the worktree"
            engine={workerEngine}
            model={workerModel}
            onEngine={setWorkerEngine}
            onModel={setWorkerModel}
          />
          <RolePicker
            label="Driver"
            hint="planner + evaluator · in the main repo"
            engine={driverEngine}
            model={driverModel}
            onEngine={setDriverEngine}
            onModel={setDriverModel}
          />
        </div>

        {error && <div className="mb-3 text-[11px] text-amber-400">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[12px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={() => void launch()}
            disabled={!goal.trim() || busy}
            className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-zinc-100 hover:bg-white/25 disabled:opacity-40"
          >
            {busy ? 'Starting…' : 'Start loop'}
            {!busy && <ArrowRight size={13} strokeWidth={2} />}
          </button>
        </div>
      </div>
    </div>
  )
}
