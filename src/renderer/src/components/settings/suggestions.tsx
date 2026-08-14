import { Sparkles } from 'lucide-react'
import type { Engine } from '../../lib/types'
import { EngineModelPicker } from '../EngineModelPicker'
import { Section, type SettingsCtx, type SettingsSectionSpec } from './shared'

function SuggestionModelSetting({
  label,
  engine,
  model,
  onPick,
  hint,
}: {
  label: string
  engine: Engine
  model: string
  onPick: (engine: Engine, model: string | undefined) => void
  hint: string
}) {
  return (
    <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11.5px] font-semibold text-zinc-200">{label}</div>
          <div className="mt-0.5 text-[10.5px] leading-snug text-zinc-600">{hint}</div>
        </div>
        <EngineModelPicker
          engine={engine}
          model={model || undefined}
          onChange={onPick}
          size="sm"
          align="right"
        />
      </div>
    </div>
  )
}

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save } = ctx
  return (
    <Section
      id="suggestions"
      icon={Sparkles}
      title="Suggested replies"
      desc="Per-terminal modes decide when to use these standalone engines. Enhance mode rewrites a draft prompt through the configured AI suggestion engine before sending."
    >
      <div className="space-y-2">
        <SuggestionModelSetting
          label="AI suggestion model"
          engine={s.suggestions.aiEngine}
          model={s.suggestions.aiModel}
          onPick={(aiEngine, aiModel) =>
            save({ suggestions: { aiEngine, aiModel: aiModel || '' } })
          }
          hint="Used when a terminal is set to AI mode and shows 1-5 suggested next replies."
        />
        <SuggestionModelSetting
          label="Auto-send model"
          engine={s.suggestions.autoEngine}
          model={s.suggestions.autoModel}
          onPick={(autoEngine, autoModel) =>
            save({ suggestions: { autoEngine, autoModel: autoModel || '' } })
          }
          hint="Used when a terminal is set to Auto mode. TerMinal asks for one best reply and submits it after completion."
        />
        <div className="grid gap-1.5 text-[10.5px] text-zinc-500 sm:grid-cols-3">
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <span className="block text-zinc-300">Rules</span>
            <span>Deterministic suggestions only</span>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <span className="block text-zinc-300">AI</span>
            <span>Shows suggestions for you to choose</span>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            <span className="block text-zinc-300">Enhance / Auto</span>
            <span>Rewrite a draft prompt; auto submits one reply</span>
          </div>
        </div>
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'suggestions',
  title: 'Replies',
  icon: Sparkles,
  order: 11,
  Component,
}
export default section
