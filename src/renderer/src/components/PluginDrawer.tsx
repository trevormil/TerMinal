import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { useState } from 'react'
import { dropIndex, reorderOnDrop } from '../lib/dragReorder'
import type { Plugin } from '../lib/types'

// The "plugins" panel. No remote registry — entries are code
// folders in the repo plus command widgets (global / per-repo). Toggling just
// mounts/unmounts. Rows are listed in cockpit order; drag a row (or use the
// chevrons — the keyboard-accessible fallback) to rearrange, and the
// arrangement persists.
export function PluginDrawer({
  plugins,
  enabled,
  onToggle,
  onMove,
  onReorder,
  onClose,
}: {
  plugins: Plugin[]
  enabled: string[]
  onToggle: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onReorder: (ids: string[]) => void
  onClose: () => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const endDrag = () => {
    setDragId(null)
    setDropAt(null)
  }
  return (
    <div className="absolute inset-0 z-20 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-[360px] gt-pop-in overflow-y-auto border-l border-[var(--gt-border)] bg-[var(--gt-panel)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wide text-zinc-100">Plugins</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5"
          >
            Esc
          </button>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-zinc-500">
          Each plugin is a folder under{' '}
          <code className="rounded bg-black/40 px-1 text-zinc-400">src/renderer/src/plugins/</code>.
          Toggle one on and it mounts instantly. Add your own: fork + edit{' '}
          <code className="rounded bg-black/40 px-1 text-zinc-400">poll</code>/
          <code className="rounded bg-black/40 px-1 text-zinc-400">render</code>, or declare a
          command widget in{' '}
          <code className="rounded bg-black/40 px-1 text-zinc-400">.TerMinal/widgets.json</code>.
        </p>

        <div className="space-y-2">
          {plugins.map((p, i) => {
            const on = enabled.includes(p.id)
            const Icon = p.icon
            const dragging = dragId === p.id
            return (
              <div
                key={p.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', p.id)
                  e.dataTransfer.effectAllowed = 'move'
                  setDragId(p.id)
                }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const r = e.currentTarget.getBoundingClientRect()
                  setDropAt(dropIndex(i, e.clientY < r.top + r.height / 2 ? 'top' : 'bottom'))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (dragId && dropAt !== null) {
                    const next = reorderOnDrop(
                      plugins.map((x) => x.id),
                      dragId,
                      dropAt,
                    )
                    if (next) onReorder(next)
                  }
                  endDrag()
                }}
                onDragEnd={endDrag}
                onClick={() => onToggle(p.id)}
                className={`relative flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                  on
                    ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10'
                    : 'border-[var(--gt-border)] bg-black/20 hover:bg-white/5'
                } ${dragging ? 'opacity-40' : ''}`}
              >
                {dragId && !dragging && dropAt === i && (
                  <span className="pointer-events-none absolute inset-x-1 -top-[5px] h-0.5 rounded-full bg-[var(--gt-accent)]" />
                )}
                {dragId && !dragging && i === plugins.length - 1 && dropAt === i + 1 && (
                  <span className="pointer-events-none absolute inset-x-1 -bottom-[5px] h-0.5 rounded-full bg-[var(--gt-accent)]" />
                )}
                <GripVertical
                  size={14}
                  strokeWidth={2}
                  className="mt-1 shrink-0 cursor-grab text-zinc-600 active:cursor-grabbing"
                />
                <Icon
                  size={18}
                  strokeWidth={2}
                  className={`mt-0.5 shrink-0 ${on ? 'text-[var(--gt-accent-light)]' : 'text-zinc-400'}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-zinc-100">{p.title}</span>
                    <code className="rounded bg-black/40 px-1 text-[10px] text-zinc-500">
                      {p.id}
                    </code>
                  </div>
                  <div className="text-[11px] leading-snug text-zinc-500">{p.blurb}</div>
                </div>
                <span className="flex shrink-0 flex-col">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onMove(p.id, -1)
                    }}
                    disabled={i === 0}
                    title="Move up"
                    className="flex h-4 w-5 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-25"
                  >
                    <ChevronUp size={12} strokeWidth={2.5} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onMove(p.id, 1)
                    }}
                    disabled={i === plugins.length - 1}
                    title="Move down"
                    className="flex h-4 w-5 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-25"
                  >
                    <ChevronDown size={12} strokeWidth={2.5} />
                  </button>
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(p.id)
                  }}
                  title={on ? 'Disable' : 'Enable'}
                  className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                    on ? 'justify-end bg-[var(--gt-accent)]' : 'justify-start bg-zinc-700'
                  }`}
                >
                  <span className="h-4 w-4 rounded-full bg-white" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
