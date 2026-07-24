import type { Tab } from '../lib/types'

// Auto-discover full-screen tabs: src/renderer/src/tabs/<id>/index.tsx that
// default-exports a Tab. Same "it's just a folder" model as plugins — repo-aware
// via each tab's appliesTo(ctx).
const modules = import.meta.glob('./*/index.tsx', { eager: true }) as Record<
  string,
  { default?: Tab }
>

// 'hitl' (Inbox), 'search', and 'activity' are global top-right overlays, not
// full-screen tabs — they're rendered from App's header, so keep them out of
// the tab bar even though their folders default-export a Tab spec.
export const ALL_TABS: Tab[] = Object.values(modules)
  .map((m) => m.default)
  .filter((t): t is Tab => !!t && t.id !== 'hitl' && t.id !== 'search' && t.id !== 'activity')
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.title.localeCompare(b.title))
