import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import { Mermaid } from './Mermaid'
import { splitFrontmatter } from '../../../shared/frontmatter'

// Lightweight INLINE markdown for compact, high-volume rows (the Activity feed).
// react-markdown is too heavy to run per-row across a streaming list, and its
// block output breaks single-line truncation. This handles just the inline
// spans — `code`, **bold**, *italic*, ~~strike~~, [text](url) — on one line, so
// it slots inside a `truncate` container. Block syntax (headings, bullets) is
// flattened to plain text.
const INLINE_RE =
  /`([^`]+)`|\*\*([^*]+?)\*\*|~~([^~]+?)~~|\[([^\]]+?)\]\((https?:\/\/[^)\s]+)\)|(?<![\w*])\*([^*\n]+?)\*(?![\w*])|(?<![\w_])_([^_\n]+?)_(?![\w_])/g

export function InlineMd({ text }: { text: string }): ReactNode {
  // Collapse to one line + strip a leading heading marker so a `## Title` detail
  // doesn't render its hashes.
  const clean = text.replace(/\s*\n+\s*/g, ' ').replace(/^\s*#{1,6}\s+/, '')
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(clean))) {
    if (m.index > last) out.push(clean.slice(last, m.index))
    if (m[1] !== undefined)
      out.push(
        <code
          key={key++}
          className="rounded bg-black/30 px-1 font-mono text-[0.9em] text-[var(--gt-accent-2)]"
        >
          {m[1]}
        </code>,
      )
    else if (m[2] !== undefined)
      out.push(
        <strong key={key++} className="font-semibold text-zinc-100">
          {m[2]}
        </strong>,
      )
    else if (m[3] !== undefined)
      out.push(
        <del key={key++} className="opacity-60">
          {m[3]}
        </del>,
      )
    else if (m[4] !== undefined) {
      // Capture the URL now. `m` is the loop's mutable exec() result and is null
      // once the loop ends, so a handler closing over it dereferences null on
      // click — and preventDefault has already killed the browser fallback,
      // leaving the link dead both ways.
      const href = m[5]
      out.push(
        <a
          key={key++}
          href={href}
          onClick={(e) => {
            e.preventDefault()
            window.gt.openExternal(href)
          }}
          className="text-[var(--gt-accent-2)] hover:underline"
        >
          {m[4]}
        </a>,
      )
    } else if (m[6] !== undefined)
      out.push(
        <em key={key++} className="italic">
          {m[6]}
        </em>,
      )
    else if (m[7] !== undefined)
      out.push(
        <em key={key++} className="italic">
          {m[7]}
        </em>,
      )
    last = m.index + m[0].length
  }
  if (last < clean.length) out.push(clean.slice(last))
  return <>{out}</>
}

function highlighted(code: string, className?: string): string {
  const lang = className?.replace(/^language-/, '')
  try {
    if (lang && hljs.getLanguage(lang))
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    return hljs.highlightAuto(code).value
  } catch {
    return code.replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] || ch,
    )
  }
}

// Shared markdown renderer (ticket bodies, MR descriptions, review bodies).
// Hand-styled with Tailwind utilities so we don't pull in the typography plugin.
export function Markdown({
  children,
  className = 'text-[13px] text-[var(--gt-text-soft)]',
}: {
  children: string
  className?: string
}) {
  const { frontmatter, body } = splitFrontmatter(children)
  return (
    <div className={className}>
      {frontmatter.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border border-[var(--gt-border)] bg-black/20">
          <div className="border-b border-[var(--gt-border)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            Frontmatter
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-3 py-2 text-[11.5px]">
            {frontmatter.map(([k, v]) => (
              <div key={k} className="contents">
                <span className="font-mono text-zinc-500">{k}</span>
                <span className="min-w-0 break-words text-zinc-300">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
          h1: ({ children }) => (
            <h1 className="mb-2 mt-5 text-xl font-bold tracking-tight text-zinc-50">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 text-base font-bold text-zinc-100">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 text-sm font-bold uppercase tracking-wide text-zinc-200">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1.5 mt-3 text-sm font-semibold text-zinc-200">{children}</h4>
          ),
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          code: (props) => {
            const { className, children, ...rest } = props as {
              className?: string
              children?: React.ReactNode
            }
            // ```mermaid fences render as real diagrams (the component falls
            // back to source on a parse error, so a bad diagram never blanks).
            if (className === 'language-mermaid') {
              return <Mermaid source={String(children ?? '').replace(/\n$/, '')} />
            }
            // code blocks come wrapped in <pre>; we detect via className="language-*"
            if (className && className.startsWith('language-')) {
              const code = String(children ?? '').replace(/\n$/, '')
              return (
                <code
                  className={`hljs font-mono ${className}`}
                  dangerouslySetInnerHTML={{ __html: highlighted(code, className) }}
                  {...rest}
                />
              )
            }
            return (
              <code className="rounded border border-[var(--gt-border)] bg-[var(--gt-code-bg)] px-1 py-0.5 font-mono text-[12px] text-[var(--gt-accent-2)]">
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-lg border border-[var(--gt-border)] bg-[var(--gt-code-bg)] p-3 text-[12px] text-[var(--gt-text-soft)]">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-[var(--gt-border)] pl-3 italic text-zinc-400">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href) window.gt.openExternal(href)
              }}
              className="text-[var(--gt-accent-2)] hover:underline"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto">
              <table className="border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[var(--gt-border)] px-2 py-1 font-bold text-zinc-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--gt-border)] px-2 py-1">{children}</td>
          ),
          hr: () => <hr className="my-4 border-[var(--gt-border)]" />,
          input: (props) => {
            // GFM task-list checkboxes
            if ((props as { type?: string }).type === 'checkbox') {
              return (
                <input
                  {...props}
                  disabled
                  className="mr-1 align-middle accent-[var(--gt-accent)]"
                />
              )
            }
            return <input {...props} />
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
