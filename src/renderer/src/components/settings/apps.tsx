import { AppWindow } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Section, Toggle, type SettingsCtx, type SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save, env } = ctx
  const appOptions = (detected: string[] | undefined, fallback: string[], current: string) => {
    const list = [
      ...new Set([...(detected?.length ? detected : fallback), ...(current ? [current] : [])]),
    ]
    return list.map((a) => (
      <SelectItem key={a} value={a}>
        {a}
      </SelectItem>
    ))
  }

  return (
    <Section
      id="apps"
      icon={AppWindow}
      title="External apps"
      desc="Which app the Files tab's 'Open in editor' and the Browser tab's 'Open in browser' hand off to. Runs `open -a <app>` (works for any installed macOS app)."
    >
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-[12px] text-zinc-400">
          Editor
          <Select
            value={s.apps.editor || 'Cursor'}
            onValueChange={(v) => save({ apps: { editor: v } })}
          >
            <SelectTrigger className="w-auto min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {appOptions(env?.apps.editors, ['Cursor', 'Visual Studio Code'], s.apps.editor)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-zinc-400">
          Browser
          <Select
            value={s.apps.browser || 'Brave Browser'}
            onValueChange={(v) => save({ apps: { browser: v } })}
          >
            <SelectTrigger className="w-auto min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {appOptions(env?.apps.browsers, ['Brave Browser'], s.apps.browser)}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="mt-3">
        <Toggle
          on={s.apps.formatOnSave}
          onToggle={() => save({ apps: { formatOnSave: !s.apps.formatOnSave } })}
          label="Format on save (Files tab)"
          hint="⌘S runs the project's own prettier before writing. Skipped when the project has no prettier install or prettier doesn't own the file."
        />
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'apps',
  title: 'Apps',
  icon: AppWindow,
  order: 7,
  Component,
}
export default section
