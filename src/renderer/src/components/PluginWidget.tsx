import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ErrorBoundary } from './ErrorBoundary'
import type { Plugin } from '../lib/types'
import { createTickCoalescer } from '../lib/tickCoalescer'

// Runs one plugin's poll loop and renders its card. `prev` is threaded into poll
// so rate/delta widgets (burn-rate) can diff against the last sample. A hover ×
// hides (disables) the widget inline.
export function pluginPollSubscriptionKey(plugin: Plugin): string {
  return `${plugin.id}\0${plugin.intervalMs}\0${plugin.realtime ? '1' : '0'}`
}

export function PluginWidget({
  plugin,
  onHide,
  chrome,
}: {
  plugin: Plugin
  onHide?: (id: string) => void
  /**
   * Alternative wrapper around the rendered body, for hosts that draw their own
   * frame — the work column's accordion passes its section here. It receives
   * the latest poll result so the host can title/count from live data without
   * lifting state (and without the plugin mounting twice to get it).
   */
  chrome?: (body: ReactNode, data: unknown) => ReactNode
}) {
  const [data, setData] = useState<unknown>(null)
  const prevRef = useRef<unknown>(null)
  const pluginRef = useRef(plugin)
  pluginRef.current = plugin
  const subscriptionKey = pluginPollSubscriptionKey(plugin)

  useEffect(() => {
    let alive = true
    let inFlight = false
    let queued = false
    const tick = async () => {
      if (inFlight) {
        queued = true
        return
      }
      inFlight = true
      try {
        const next = await pluginRef.current.poll(window.gt, prevRef.current as never)
        if (!alive) return
        prevRef.current = next
        setData(next)
      } catch {
        /* transient read error — keep last good data */
      } finally {
        inFlight = false
        if (alive && queued) {
          queued = false
          void tick()
        }
      }
    }
    // Defer the first poll by one frame so the cockpit mount (8+ widgets)
    // doesn't dump N IPCs in the same tick as a session switch.
    const raf = requestAnimationFrame(tick)
    const id = setInterval(tick, pluginRef.current.intervalMs)
    // realtime widgets also refresh the instant the transcript changes
    const coalescedTick = createTickCoalescer(tick)
    const offTick = pluginRef.current.realtime ? window.gt.onTick(coalescedTick.trigger) : undefined
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearInterval(id)
      coalescedTick.cancel()
      offTick?.()
    }
  }, [subscriptionKey])

  const body = <ErrorBoundary label={plugin.title}>{plugin.render(data as never)}</ErrorBoundary>
  // The boundary sits INSIDE the host chrome so a crashed plugin loses its body
  // but keeps its accordion header — the section stays collapsible.
  if (chrome) return <>{chrome(body, data)}</>

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
      {body}
    </div>
  )
}
