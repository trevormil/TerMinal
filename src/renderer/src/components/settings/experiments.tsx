import { FlaskConical } from 'lucide-react'
import { EXPERIMENT_IDS, EXPERIMENT_META, type ExperimentId } from '../../../../shared/experiments'
import { useExperiment } from '../../lib/useExperiment'
import type { SettingsPatch } from '../../lib/types'
import { Section, Toggle, type SettingsCtx, type SettingsSectionSpec } from './shared'

/**
 * One experimental flag. Reads its state through `useExperiment` — the same gate
 * a flagged feature uses elsewhere — rather than off the panel's settings copy,
 * so this row is also the working example of the helper: `save` dispatches
 * `gt.settings.changed`, the hook picks it up, and every gated surface in the
 * window flips at once.
 */
function ExperimentRow({ id, save }: { id: ExperimentId; save: (patch: SettingsPatch) => void }) {
  const on = useExperiment(id)
  const meta = EXPERIMENT_META[id]
  return (
    <div data-experiment-id={id} className="flex flex-col gap-1">
      <Toggle
        on={on}
        onToggle={() => save({ experiments: { [id]: !on } })}
        label={meta.label}
        hint={meta.desc}
      />
      <div className="flex items-start gap-2 pl-2.5 text-[10.5px] leading-relaxed text-zinc-600">
        <span className="mt-px shrink-0 rounded border border-[var(--gt-yellow)]/40 bg-[var(--gt-yellow)]/10 px-1 py-px font-medium tracking-wide text-[var(--gt-yellow)] uppercase">
          Experimental
        </span>
        <span className="min-w-0">{meta.reveals}</span>
      </div>
    </div>
  )
}

function Component({ ctx }: { ctx: SettingsCtx }) {
  return (
    <Section
      id="experiments"
      icon={FlaskConical}
      title="Experimental"
      desc="Features that work but are not finished. They are off by default; turning one on reveals its surfaces in the app. Expect rough edges, and expect the behaviour, layout, and stored shape to change — including in ways that discard what an experiment produced."
    >
      <div className="flex flex-col gap-3">
        {EXPERIMENT_IDS.map((id) => (
          <ExperimentRow key={id} id={id} save={ctx.save} />
        ))}
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'experiments',
  title: 'Experimental',
  icon: FlaskConical,
  order: 20,
  Component,
}
export default section
