import type { Plugin } from '../lib/types'
import { partitionPluginHosts } from '../lib/workColumn'

// Auto-discover every plugin folder: src/renderer/src/plugins/<id>/index.tsx
// that default-exports a Plugin. Drop a folder in, it shows up here. No registry
// to edit, no registry to publish to — plugins are just code.
const modules = import.meta.glob('./*/index.tsx', { eager: true }) as Record<
  string,
  { default?: Plugin }
>

export const ALL_PLUGINS: Plugin[] = Object.values(modules)
  .map((m) => m.default)
  .filter((p): p is Plugin => !!p)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.title.localeCompare(b.title))

// The work column's two section kinds, partitioned from the one registry so no
// plugin can appear in both. SECTION_PLUGINS each get a top-level accordion
// section, in the order SECTION_PLUGIN_IDS declares (a fixed layout, not a
// reorderable stack); VITALS_PLUGINS are the widget stack inside the Vitals
// section, where the user's own order and enable/disable apply.
const hosts = partitionPluginHosts(ALL_PLUGINS)
export const VITALS_PLUGINS: Plugin[] = hosts.vitals
export const SECTION_PLUGINS: Plugin[] = hosts.sections

export function defaultEnabledIds(): string[] {
  return ALL_PLUGINS.filter((p) => p.defaultEnabled).map((p) => p.id)
}
