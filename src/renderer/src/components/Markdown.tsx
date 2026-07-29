import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import { Mermaid } from './Mermaid'
import { splitFrontmatter } from '../../../shared/frontmatter'
import { parseInline } from '../../../shared/inline-md'

// Lightweight INLINE markdown for compact, high-volume rows (the Activity feed).
// react-markdown is too heavy to run per-row across a streaming list, and its
// block output breaks single-line truncation. This handles just the inline
// spans — `code`, **bold**, *italic*, ~~strike~~, [text](url) — on one line, so
// it slots inside a `truncate` container. Block syntax (headings, bullets) is
// flattened to plain text.
//
// The parsing lives in src/shared/inline-md.ts so it can be unit-tested without
// a DOM; this component only maps tokens to elements.
export function InlineMd({
  text,
  keepLineBreaks,
}: {
  text: string
  /** Render the source's paragraph breaks instead of flattening to one line —
   *  pass this once a row is no longer clamped to a single/fixed line count. */
  keepLineBreaks?: boolean
}): ReactNode {
  // A plain-text token can itself contain \n when keepLineBreaks is set —
  // split it into <br />-separated fragments rather than letting the browser
  // silently collapse the newline the way default `white-space` handling does.
  const withBreaks = (key: string | number, text: string): ReactNode => {
    const lines = text.split('\n')
    if (lines.length === 1) return text
    return lines.map((line, j) => (
      <span key={`${key}-${j}`}>
        {line}
        {j < lines.length - 1 && <br />}
      </span>
    ))
  }
  return (
    <>
      {parseInline(text, { keepLineBreaks }).map((t, i) => {
        switch (t.kind) {
          case 'code':
            return (
              <code
                key={i}
                className="rounded bg-black/30 px-1 font-mono text-[0.9em] text-[var(--gt-accent-2)]"
              >
                {t.text}
              </code>
            )
          case 'bold':
            return (
              <strong key={i} className="font-semibold text-zinc-100">
                {t.text}
              </strong>
            )
          case 'strike':
            return (
              <del key={i} className="opacity-60">
                {t.text}
              </del>
            )
          case 'italic':
            return (
              <em key={i} className="italic">
                {t.text}
              </em>
            )
          case 'link':
            return (
              <a
                key={i}
                href={t.href}
                onClick={(e) => {
                  e.preventDefault()
                  window.gt.openExternal(t.href)
                }}
                className="text-[var(--gt-accent-2)] hover:underline"
              >
                {t.text}
              </a>
            )
          default:
            return <span key={i}>{withBreaks(i, t.text)}</span>
        }
      })}
    </>
  )
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
