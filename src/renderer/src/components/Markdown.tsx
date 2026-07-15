import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'

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
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[13px] text-[var(--gt-text-soft)]">
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
        {children}
      </ReactMarkdown>
    </div>
  )
}
