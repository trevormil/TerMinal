import { Moon, Monitor, Palette, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppearanceMode, AppearanceTabLayout } from '../../lib/types'
import { ACCENT_SWATCHES, THEMES } from '../../lib/themes'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Section, type SettingsCtx, type SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save } = ctx
  const scalePct = Math.round((s.appearance.uiScale || 1) * 100)
  const modeOpt = (mode: AppearanceMode, label: string, Icon: LucideIcon) => (
    <button
      key={mode}
      onClick={() => save({ appearance: { mode } })}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
        s.appearance.mode === mode
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
          : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
      }`}
    >
      <Icon size={14} strokeWidth={2} className="shrink-0" />
      <span className="text-[12px] font-semibold">{label}</span>
    </button>
  )
  const tabLayoutOpt = (layout: AppearanceTabLayout, label: string, hint: string) => (
    <button
      key={layout}
      onClick={() => save({ appearance: { tabLayout: layout } })}
      className={`flex min-w-0 flex-1 flex-col rounded-lg border px-3 py-2 text-left transition-colors ${
        s.appearance.tabLayout === layout
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
          : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
      }`}
    >
      <span className="text-[12px] font-semibold">{label}</span>
      <span className="mt-0.5 text-[10.5px] text-zinc-500">{hint}</span>
    </button>
  )

  return (
    <Section
      id="appearance"
      icon={Palette}
      title="Appearance"
      desc="Color mode and theme tokens. New installs default to dark; system follows the OS setting."
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {modeOpt('dark', 'Dark', Moon)}
          {modeOpt('light', 'Light', Sun)}
          {modeOpt('system', 'System', Monitor)}
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_1.2fr]">
          <div className="grid grid-cols-2 gap-2">
            {tabLayoutOpt('horizontal', 'Top tabs', 'Classic row across the session header')}
            {tabLayoutOpt('sidebar', 'Sidebar tabs', 'Vertical nav beside the active view')}
          </div>
          <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 px-3 py-2">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-zinc-200">UI scale</div>
                <div className="text-[10.5px] text-zinc-500">Scales the whole app shell.</div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => save({ appearance: { uiScale: 1 } })}
              >
                {scalePct}%
              </Button>
            </div>
            <input
              type="range"
              min={85}
              max={135}
              step={5}
              value={scalePct}
              onChange={(e) => save({ appearance: { uiScale: Number(e.target.value) / 100 } })}
              className="w-full accent-[var(--gt-accent)]"
            />
            <div className="mt-1 flex justify-between text-[9.5px] text-zinc-600">
              <span>85</span>
              <span>100</span>
              <span>135</span>
            </div>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--gt-border)] bg-black/20 px-2.5 py-2 text-[12px] text-zinc-400">
            Theme
            <Select
              value={s.appearance.theme}
              onValueChange={(v) => save({ appearance: { theme: v } })}
            >
              <SelectTrigger className="min-w-0 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map((theme) => (
                  <SelectItem key={theme.id} value={theme.id}>
                    {theme.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--gt-border)] bg-black/20 px-2 py-1.5">
            {ACCENT_SWATCHES.map((swatch) => {
              const on = s.appearance.accent === swatch.id
              return (
                <button
                  key={swatch.title}
                  onClick={() => save({ appearance: { accent: swatch.id } })}
                  title={swatch.title}
                  className={`h-6 w-6 rounded-md border transition-colors ${
                    on
                      ? 'border-[var(--gt-accent-light)]'
                      : 'border-[var(--gt-border)] hover:border-[var(--gt-accent)]/60'
                  }`}
                  style={{ background: swatch.color || 'var(--gt-grad)' }}
                />
              )
            })}
          </div>
        </div>
        <div className="grid gap-2 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/70 p-2 md:grid-cols-[1fr_1.2fr]">
          <div className="rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-zinc-100">Preview</span>
              <span className="rounded border border-[var(--gt-border)] px-1.5 py-0.5 text-[9.5px] text-zinc-500">
                {s.appearance.mode}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="h-2 rounded-full bg-[var(--gt-accent)]" />
              <div className="h-2 w-4/5 rounded-full bg-[var(--gt-border)]" />
              <div className="h-2 w-2/3 rounded-full bg-[var(--gt-panel)]" />
            </div>
          </div>
          <div className="rounded-md border border-[var(--gt-border)] bg-[var(--gt-terminal-bg)] p-2 font-mono text-[11px] text-[var(--gt-terminal-fg)]">
            <div className="text-[var(--gt-green)]">$ terminal theme check</div>
            <div className="text-[var(--gt-text-muted)]">
              tokens apply to chrome, panes, scrollbars, and terminals
            </div>
            <div>
              <span className="text-[var(--gt-accent-light)]">accent</span>
              <span className="text-[var(--gt-text-muted)]"> / </span>
              <span className="text-[var(--gt-blue)]">info</span>
              <span className="text-[var(--gt-text-muted)]"> / </span>
              <span className="text-[var(--gt-yellow)]">warn</span>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'appearance',
  title: 'Appearance',
  icon: Palette,
  order: 2,
  Component,
}
export default section
