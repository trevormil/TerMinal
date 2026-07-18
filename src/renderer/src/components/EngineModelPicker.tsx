import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { Engine } from '../lib/types'
import { engineLabel, ENGINE_MODELS as MODELS, ENGINE_VENDOR as VENDOR } from '../lib/engines'
import { EngineLogo } from './EngineLogo'

// One DRY surface for the "pick engine + model" UX everywhere a run is
// configured (Agents tab, Schedules form, designer modals, ticket spawn).
// A click pops a small panel with both engines + their model chips so the
// operator can pick "claude · haiku" in one go instead of cascading through
// two separate selects. The catalog itself lives in lib/engines.

type MenuPos = { top: number; left: number; maxHeight: number }

export function EngineModelPicker({
  engine,
  model,
  onChange,
  size = 'md',
  align = 'left',
  engines,
}: {
  engine: Engine
  model: string | undefined
  onChange: (engine: Engine, model: string | undefined) => void
  size?: 'sm' | 'md'
  align?: 'left' | 'right'
  /** Restrict which engines are offered (e.g. exclude 'openrouter' for
   *  interactive sessions). Defaults to every engine with a model catalog. */
  engines?: Engine[]
}) {
  const engineList = engines ?? (Object.keys(MODELS) as Engine[])
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updateMenuPosition = () => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = 300
    const gutter = 8
    const preferredHeight = 430
    const spaceBelow = window.innerHeight - rect.bottom - gutter
    const spaceAbove = rect.top - gutter
    const left =
      align === 'right'
        ? Math.max(gutter, Math.min(window.innerWidth - width - gutter, rect.right - width))
        : Math.max(gutter, Math.min(window.innerWidth - width - gutter, rect.left))
    if (spaceBelow < 260 && spaceAbove > spaceBelow) {
      const maxHeight = Math.max(180, Math.min(preferredHeight, spaceAbove - 6))
      setMenuPos({ top: Math.max(gutter, rect.top - maxHeight - 6), left, maxHeight })
    } else {
      setMenuPos({
        top: rect.bottom + 6,
        left,
        maxHeight: Math.max(180, Math.min(preferredHeight, spaceBelow - 6)),
      })
    }
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    updateMenuPosition()
    const onMove = () => updateMenuPosition()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, align])

  const trigger =
    size === 'sm'
      ? 'gap-1.5 rounded-md px-1.5 py-1 text-[11px]'
      : 'gap-2 rounded-lg px-2.5 py-1.5 text-[12px]'

  const modelLabel = model || 'default'

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center border border-[var(--gt-border)] bg-black/30 text-zinc-200 hover:border-[var(--gt-accent)]/60 ${trigger}`}
        title="Pick the engine + model — model defaults to the engine's default when not set."
      >
        <EngineLogo engine={engine} size={size === 'sm' ? 11 : 13} />
        <span>{engineLabel(engine)}</span>
        <span className="text-zinc-600">·</span>
        <span className={model ? 'text-zinc-200' : 'text-zinc-500'}>{modelLabel}</span>
        <ChevronDown size={size === 'sm' ? 10 : 12} strokeWidth={2} className="text-zinc-500" />
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="fixed z-[10000] w-[300px] overflow-y-auto rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-2.5 shadow-2xl"
            style={{ top: menuPos.top, left: menuPos.left, maxHeight: menuPos.maxHeight }}
          >
            {engineList.map((e) => {
              const isActive = e === engine
              return (
                <div key={e} className="mb-2 last:mb-0">
                  <div className="mb-1 flex items-center gap-1.5 px-1">
                    <EngineLogo engine={e} size={12} />
                    <span className="text-[11px] font-semibold text-zinc-200">
                      {engineLabel(e)}
                    </span>
                    <span className="text-[10px] text-zinc-600">· {VENDOR[e]}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 px-1">
                    <button
                      onClick={() => {
                        onChange(e, undefined)
                        setOpen(false)
                      }}
                      className={`rounded-md border px-2 py-0.5 text-[10.5px] ${
                        isActive && !model
                          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
                          : 'border-[var(--gt-border)] text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      }`}
                    >
                      Default
                    </button>
                    {MODELS[e].map((m) => {
                      const selected = isActive && model === m.id
                      return (
                        <button
                          key={m.id}
                          onClick={() => {
                            onChange(e, m.id)
                            setOpen(false)
                          }}
                          className={`rounded-md border px-2 py-0.5 text-[10.5px] ${
                            selected
                              ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
                              : 'border-[var(--gt-border)] text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                          }`}
                        >
                          {m.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            <div className="mt-1 border-t border-[var(--gt-border)]/60 px-1 pt-1.5 text-[9.5px] text-zinc-600">
              Pick a model only when you want to override the engine default.
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
