import { useEffect, type CSSProperties } from 'react'
import { Keyboard } from 'lucide-react'

// ⌘/ cheat-sheet: every shortcut here was previously undiscoverable outside
// the source. Kept as a flat static list (not derived from a registry —
// there isn't one) so it's cheap to keep honest: add a line here whenever a
// new shortcut lands elsewhere in the app.

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties

type ShortcutGroup = { title: string; items: { keys: string; label: string }[] }

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Sessions',
    items: [
      { keys: '⌃Tab / ⌃⇧Tab', label: 'Hold to cycle sessions (MRU order), release to switch' },
      { keys: '⌘⇧[ / ⌘⇧]', label: 'Cycle sessions directly' },
      { keys: '⌘1 – ⌘9', label: 'Jump to session by number' },
      { keys: '⌘⇧T', label: 'New local terminal tab' },
      { keys: 'Right-click a tab', label: "Close Other Tabs / Close All Tabs" },
    ],
  },
  {
    title: 'Sub-tabs (within a session)',
    items: [
      { keys: '⌘[ / ⌘]', label: 'Cycle sub-tabs (Terminal, Files, Tickets, …)' },
      { keys: '⌥1 – ⌥9', label: 'Jump to sub-tab by number' },
      { keys: '⌥← / ⌥→', label: 'Step to the previous/next sub-tab' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { keys: '⌘K / ⌃K', label: 'Command palette — files, tickets, MRs/PRs, search, commands' },
      { keys: '⌘/', label: 'This shortcuts overlay' },
      { keys: 'Esc', label: 'Close whichever modal/popover is open' },
    ],
  },
  {
    title: 'Files tab',
    items: [
      { keys: '⌘S', label: 'Save (format-on-save if enabled) — otherwise autosaves as you type' },
      { keys: '⌘W', label: 'Close the active file tab' },
      { keys: '⌘⇧F', label: 'Open the search sidebar' },
    ],
  },
  {
    title: 'Browser tab',
    items: [
      { keys: '⌘F', label: 'Find in page' },
      { keys: '⌘L', label: 'Focus the address bar' },
    ],
  },
  {
    title: 'Terminal',
    items: [{ keys: 'Right-click', label: 'Copy, paste, send-to-agent, file a ticket, and more' }],
  },
]

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        style={noDrag}
        className="flex max-h-[75vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--gt-border)] px-3.5 py-2.5">
          <Keyboard size={16} className="text-zinc-500" />
          <span className="text-[13px] font-semibold text-zinc-100">Keyboard shortcuts</span>
          <span className="ml-auto text-[11px] text-zinc-600">Esc to close</span>
        </div>
        <div className="overflow-y-auto p-3.5">
          {GROUPS.map((g) => (
            <div key={g.title} className="mb-4 last:mb-0">
              <div className="mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                {g.title}
              </div>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <div
                    key={it.keys}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-white/[0.03]"
                  >
                    <span className="shrink-0 rounded border border-[var(--gt-border)] bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                      {it.keys}
                    </span>
                    <span className="text-[12px] text-zinc-400">{it.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
