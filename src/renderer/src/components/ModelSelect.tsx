import type { Engine } from '../lib/types'
import { ENGINE_MODELS, engineAllowsCustomModel } from '../lib/engines'

// A full model-selection surface (its own step/screen), not a cramped dropdown.
// Renders a "default" card plus each of the engine's models as selectable cards.
// For engines that take an arbitrary slug (OpenRouter) it also shows a free-text
// field so you can run any model. `model === undefined` means the engine default.
export function ModelSelect({
  engine,
  model,
  onChange,
}: {
  engine: Engine
  model: string | undefined
  onChange: (model: string | undefined) => void
}) {
  const models = ENGINE_MODELS[engine] ?? []
  const custom = engineAllowsCustomModel(engine)
  const knownIds = new Set(models.map((m) => m.id))
  // For a custom engine, a typed slug that isn't in the menu still counts as selected.
  const customActive = custom && !!model && !knownIds.has(model)

  const card = (selected: boolean) =>
    `rounded-xl border px-3 py-2.5 text-left transition-colors ${
      selected
        ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/10 text-zinc-100'
        : 'border-[var(--gt-border)] bg-black/20 text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:bg-white/5'
    }`

  return (
    <div className="space-y-3">
      {custom && (
        <label className="block">
          <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-zinc-500">Any OpenRouter model</span>
          <input
            value={model ?? ''}
            onChange={(e) => onChange(e.target.value.trim() || undefined)}
            placeholder="e.g. deepseek/deepseek-v3.2 — any slug from openrouter.ai/models"
            spellCheck={false}
            autoComplete="off"
            className={`w-full rounded-lg border bg-black/30 px-2.5 py-2 font-mono text-[12px] text-zinc-200 outline-none ${
              customActive ? 'border-[var(--gt-accent)]/70' : 'border-[var(--gt-border)]'
            } focus:border-[var(--gt-accent)]/60`}
          />
          <span className="mt-1 block text-[10px] text-zinc-600">Or pick a common one below.</span>
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className={card(!model)}
          title="Uses the model configured for this engine in Settings (or the CLI's own default if none is set)."
        >
          <div className="text-[13px] font-semibold">Default</div>
        </button>
        {models.map((m) => (
          <button key={m.id} type="button" onClick={() => onChange(m.id)} className={card(model === m.id)}>
            <div className="truncate text-[13px] font-semibold">{m.label}</div>
            <div className="truncate font-mono text-[10px] text-zinc-600">{m.id}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
