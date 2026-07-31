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

// The two hosts, partitioned from the one registry so no plugin can appear in
// both. The cockpit renders COCKPIT_PLUGINS; the work column's accordion
// renders COLUMN_PLUGINS, in the order COLUMN_PLUGIN_IDS declares (the column
// is a fixed three-section layout, not a reorderable widget stack).
const hosts = partitionPluginHosts(ALL_PLUGINS)
export const COCKPIT_PLUGINS: Plugin[] = hosts.cockpit
export const COLUMN_PLUGINS: Plugin[] = hosts.column

export function defaultEnabledIds(): string[] {
  return ALL_PLUGINS.filter((p) => p.defaultEnabled).map((p) => p.id)
}
