import { useCallback, useRef, useState } from 'react'

// A drag-to-resize width, persisted to localStorage. `edge` is which side of the
// panel the handle sits on: 'right' → dragging right grows it (panel is on the
// left); 'left' → dragging left grows it (panel is on the right).
export function useResizableWidth(
  key: string,
  initial: number,
  opts?: { min?: number; max?: number; edge?: 'left' | 'right' },
): { width: number; onResizeStart: (e: React.MouseEvent) => void } {
  const min = opts?.min ?? 160
  const max = opts?.max ?? 720
  const edge = opts?.edge ?? 'right'
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const [width, setWidth] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(key))
      return v > 0 ? clamp(v) : initial
    } catch {
      return initial
    }
  })
  const start = useRef({ x: 0, w: width })

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      start.current = { x: e.clientX, w: width }
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - start.current.x
        setWidth(clamp(edge === 'left' ? start.current.w - dx : start.current.w + dx))
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setWidth((w) => {
          try {
            localStorage.setItem(key, String(Math.round(w)))
          } catch {
            /* ignore */
          }
          return w
        })
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, key, min, max, edge],
  )

  return { width, onResizeStart }
}

// A thin draggable divider. Drop it as a flex sibling between two panes, or
// absolutely-position it at a panel edge (pass positioning via className).
export function ResizeHandle({
  onMouseDown,
  className = '',
  style,
}: {
  onMouseDown: (e: React.MouseEvent) => void
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to resize"
      style={style}
      className={`group z-10 -mx-0.5 flex w-1 shrink-0 cursor-col-resize items-stretch ${className}`}
    >
      {/* Invisible at rest (the panel's own border is the divider); shows the
          accent only while hovering/dragging so there's no doubled-up line. */}
      <div className="mx-auto w-px bg-transparent transition-colors group-hover:bg-[var(--gt-accent)]" />
    </div>
  )
}
