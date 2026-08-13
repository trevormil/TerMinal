import type { SettingsSectionSpec } from './shared'

// Auto-discover settings sections: src/renderer/src/components/settings/<id>.tsx
// that default-exports a SettingsSectionSpec. Same "it's just a file" model as
// tabs/registry.ts.
const modules = import.meta.glob('./*.tsx', { eager: true }) as Record<
  string,
  { default?: SettingsSectionSpec }
>

export const SETTINGS_SECTIONS: SettingsSectionSpec[] = Object.values(modules)
  .map((m) => m.default)
  .filter((s): s is SettingsSectionSpec => !!s)
  .sort((a, b) => a.order - b.order)
