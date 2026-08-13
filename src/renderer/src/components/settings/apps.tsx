import { AppWindow } from 'lucide-react'
import { Section, Toggle, type SettingsCtx, type SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save, env } = ctx
  const appOptions = (detected: string[] | undefined, fallback: string[], current: string) => {
    const list = [
      ...new Set([...(detected?.length ? detected : fallback), ...(current ? [current] : [])]),
    ]
    return list.map((a) => (
      <option key={a} value={a} className="bg-[var(--gt-panel)]">
        {a}
      </option>
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
          <select
            value={s.apps.editor || 'Cursor'}
            onChange={(e) => save({ apps: { editor: e.target.value } })}
            className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
          >
            {appOptions(env?.apps.editors, ['Cursor', 'Visual Studio Code'], s.apps.editor)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-zinc-400">
          Browser
          <select
            value={s.apps.browser || 'Brave Browser'}
            onChange={(e) => save({ apps: { browser: e.target.value } })}
            className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
          >
            {appOptions(env?.apps.browsers, ['Brave Browser'], s.apps.browser)}
          </select>
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
