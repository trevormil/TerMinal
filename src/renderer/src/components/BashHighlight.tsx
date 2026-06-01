import { useMemo } from 'react'
import hljs from 'highlight.js/lib/common'

// Tiny wrapper around highlight.js for bash bodies. Used by the Agents +
// Schedules tabs to render script previews with syntax highlighting instead of
// flat monospace. index.css adapts the global highlight theme for light mode.
export function BashHighlight({ code, className = '' }: { code: string; className?: string }) {
  const html = useMemo(() => {
    try {
      return hljs.highlight(code, { language: 'bash', ignoreIllegals: true }).value
    } catch {
      return code
    }
  }, [code])
  return (
    <pre
      className={`overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--gt-border)] bg-[var(--gt-code-bg)] p-2 font-mono text-[10.5px] leading-relaxed text-[var(--gt-text-soft)] ${className}`}
    >
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}
