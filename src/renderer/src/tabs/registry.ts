import type { Tab } from '../lib/types'

// Auto-discover full-screen tabs: src/renderer/src/tabs/<id>/index.tsx that
// default-exports a Tab. Same "it's just a folder" model as plugins — repo-aware
// via each tab's appliesTo(ctx).
const modules = import.meta.glob('./*/index.tsx', { eager: true }) as Record<
  string,
  { default?: Tab }
>

export const ALL_TABS: Tab[] = Object.values(modules)
  .map((m) => m.default)
  .filter((t): t is Tab => !!t && t.id !== 'hitl')
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.title.localeCompare(b.title))
