import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'strict',
  fontFamily: 'ui-monospace, monospace',
})

let seq = 0

// Renders mermaid source to an SVG diagram. Falls back to the raw source on a
// parse error so a malformed diagram never blanks the view.
export function Mermaid({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let cancelled = false
    setErr(false)
    const id = `mmd-${++seq}`
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      })
      .catch(() => {
        if (!cancelled) setErr(true)
      })
    return () => {
      cancelled = true
    }
  }, [source])

  if (err)
    return (
      <pre className="overflow-x-auto rounded-lg border border-[var(--gt-border)] bg-black/40 p-3 font-mono text-[12px] text-zinc-400">
        {source}
      </pre>
    )
  return <div ref={ref} className="flex justify-center [&_svg]:max-w-full" />
}
