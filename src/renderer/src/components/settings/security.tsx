import { ShieldCheck } from 'lucide-react'
import { Section, Toggle, type SettingsCtx, type SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save } = ctx
  return (
    <Section
      id="security"
      icon={ShieldCheck}
      title="Security"
      desc="What third-party repos are allowed to bring into the app."
    >
      <Toggle
        on={s.allowRepoExtensions}
        onToggle={() => save({ allowRepoExtensions: !s.allowRepoExtensions })}
        label="Allow repo-provided widgets and tabs"
        hint="Off (default): .TerMinal/widgets.json and tabs.json from repos are ignored entirely — no commands, no embeds, no approval prompts. On: they go through the per-repo trust approval flow before anything runs. Your own global widgets/tabs (~/.config/TerMinal) are always allowed."
      />
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'security',
  title: 'Security',
  icon: ShieldCheck,
  order: 18,
  Component,
}
export default section
