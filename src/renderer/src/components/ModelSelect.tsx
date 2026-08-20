import type { Engine } from '../lib/types'
import { ENGINE_MODELS, engineAllowsCustomModel, engineEffortsOf } from '../lib/engines'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// The dropdown pair below is the COMPACT form of the two pickers in this file,
// for surfaces where model + effort are one field each in a longer form (the
// entry wizard). Same data source, so a newly registered model shows up in both
// forms at once. `DEFAULT_VALUE` stands in for `undefined` because Radix Select
// treats an empty string as "no value" and would render the placeholder for a
// deliberate "use the engine default" choice.
const DEFAULT_VALUE = '__default__'

/** Model as a dropdown. For engines that take an arbitrary slug (OpenRouter)
 *  the free-text field stays — a menu can't enumerate every model. */
export function ModelDropdown({
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
  const customActive = custom && !!model && !knownIds.has(model)
  return (
    <div className="space-y-2">
      <Select
        value={customActive ? DEFAULT_VALUE : (model ?? DEFAULT_VALUE)}
        onValueChange={(v) => onChange(v === DEFAULT_VALUE ? undefined : v)}
      >
        <SelectTrigger className="h-9 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>Default</SelectItem>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {custom && (
        <input
          value={model ?? ''}
          onChange={(e) => onChange(e.target.value.trim() || undefined)}
          placeholder="…or any slug from openrouter.ai/models"
          spellCheck={false}
          autoComplete="off"
          className={`w-full rounded-lg border bg-black/30 px-2.5 py-2 font-mono text-[12px] text-zinc-200 outline-none ${
            customActive ? 'border-[var(--gt-accent)]/70' : 'border-[var(--gt-border)]'
          } focus:border-[var(--gt-accent)]/60`}
        />
      )}
    </div>
  )
}

/** Reasoning effort as a dropdown. Renders nothing for engines without an
 *  effort control, so callers can always include it. */
export function EffortDropdown({
  engine,
  effort,
  onChange,
}: {
  engine: Engine
  effort: string | undefined
  onChange: (effort: string | undefined) => void
}) {
  const levels = engineEffortsOf(engine)
  if (!levels.length) return null
  return (
    <Select
      value={effort ?? DEFAULT_VALUE}
      onValueChange={(v) => onChange(v === DEFAULT_VALUE ? undefined : v)}
    >
      <SelectTrigger className="h-9 text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_VALUE}>Default</SelectItem>
        {levels.map((l) => (
          <SelectItem key={l} value={l}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// A full model-selection surface (its own step/screen), not a cramped dropdown.
// Renders a "default" card plus each of the engine's models as selectable cards.
// For engines that take an arbitrary slug (OpenRouter) it also shows a free-text
// field so you can run any model. `model === undefined` means the engine default.
/** Compact segmented reasoning-effort row (Default + the engine's own level
 *  tokens). Renders nothing for engines without an effort control, so callers
 *  can always include it. `effort === undefined` means the engine default. */
export function EffortSelect({
  engine,
  effort,
  onChange,
}: {
  engine: Engine
  effort: string | undefined
  onChange: (effort: string | undefined) => void
}) {
  const levels = engineEffortsOf(engine)
  if (!levels.length) return null
  const seg = (selected: boolean) =>
    `rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
      selected
        ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/10 text-zinc-100'
        : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-200'
    }`
  return (
    <div>
      <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-zinc-500">
        Reasoning effort
      </span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className={seg(!effort)}
          title="Uses the effort configured for this engine in Settings (or the CLI's own default if none is set)."
        >
          Default
        </button>
        {levels.map((l) => (
          <button key={l} type="button" onClick={() => onChange(l)} className={seg(effort === l)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

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
    `rounded-xl border px-3 py-2 text-left transition-colors ${
      selected
        ? 'border-[var(--gt-accent)]/70 bg-[var(--gt-accent)]/10 text-zinc-100'
        : 'border-[var(--gt-border)] bg-black/20 text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:bg-white/5'
    }`

  return (
    <div className="space-y-3">
      {custom && (
        <label className="block">
          <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-zinc-500">
            Any OpenRouter model
          </span>
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
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={card(model === m.id)}
          >
            <div className="truncate text-[13px] font-semibold">{m.label}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
