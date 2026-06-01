import type { Plugin } from '../lib/types'

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

export function defaultEnabledIds(): string[] {
  return ALL_PLUGINS.filter((p) => p.defaultEnabled).map((p) => p.id)
}
