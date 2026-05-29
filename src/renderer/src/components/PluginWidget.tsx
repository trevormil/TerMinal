import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { ErrorBoundary } from './ErrorBoundary'
import type { Plugin } from '../lib/types'

// Runs one plugin's poll loop and renders its card. `prev` is threaded into poll
// so rate/delta widgets (burn-rate) can diff against the last sample. A hover ×
// hides (disables) the widget inline.
export function PluginWidget({
  plugin,
  onHide,
}: {
  plugin: Plugin
  onHide?: (id: string) => void
}) {
  const [data, setData] = useState<unknown>(null)
  const prevRef = useRef<unknown>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const next = await plugin.poll(window.gt, prevRef.current as never)
        if (!alive) return
        prevRef.current = next
        setData(next)
      } catch {
        /* transient read error — keep last good data */
      }
    }
    // Defer the first poll by one frame so the cockpit mount (8+ widgets)
    // doesn't dump N IPCs in the same tick as a session switch.
    const raf = requestAnimationFrame(tick)
    const id = setInterval(tick, plugin.intervalMs)
    // realtime widgets also refresh the instant the transcript changes
    const offTick = plugin.realtime ? window.gt.onTick(tick) : undefined
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearInterval(id)
      offTick?.()
    }
  }, [plugin])

  return (
    <div className="group relative gt-pop-in">
      {onHide && (
        <button
          onClick={() => onHide(plugin.id)}
          title={`Hide ${plugin.title}`}
          className="absolute right-1.5 top-1.5 z-10 hidden h-5 w-5 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-200 group-hover:flex"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
      <ErrorBoundary label={plugin.title}>{plugin.render(data as never)}</ErrorBoundary>
    </div>
  )
}
