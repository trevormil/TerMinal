import { useEffect, useRef, useState } from 'react'
import { MessageSquareText, X } from 'lucide-react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Choice } from './EntryScreen'
import type { PromptSnippet } from '../lib/types'
import { rewriteCodexSkillSubmit } from '../lib/codexSkillInput'

// Hosts the real Claude Code or Codex CLI: xterm.js renders, the PTY (main
// process) runs the chosen engine. Same pattern VS Code's integrated
// terminal uses.
export function TerminalPane({
  sessionKey,
  choice,
  onStarted,
  active = false,
}: {
  sessionKey: string
  choice: Choice
  onStarted?: (info: { sessionId: string; cwd: string }) => void
  active?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Xterm | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [snippets, setSnippets] = useState<PromptSnippet[]>([])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => termRef.current?.focus())
  }, [active])

  useEffect(() => {
    window.gt.snippets
      .list(choice.cwd || '')
      .then((r) => setSnippets(r.snippets))
      .catch(() => setSnippets([]))
  }, [choice.cwd])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const term = new Xterm({
      fontFamily: "'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#0a0a0f',
        foreground: '#e7e7ee',
        cursor: '#7c5cff',
        selectionBackground: '#7c5cff44',
        black: '#0a0a0f',
        brightBlack: '#5b5b6e',
      },
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.gt.openExternal(uri)))
    term.open(el)
    fit.fit()

    const gt = window.gt
    let skillNames = new Set<string>(choice.engine === 'codex' ? ['ticket'] : [])
    if (choice.engine === 'codex') {
      gt.listSkills()
        .then((skills) => {
          skillNames = new Set(
            skills
              .filter((s) => s.platforms.includes('codex'))
              .map((s) => s.name),
          )
        })
        .catch(() => {
          /* the fallback set above keeps /ticket usable */
        })
    }

    let lineBuffer = ''
    const writeInput = (data: string) => {
      if (choice.engine !== 'codex') {
        gt.pty.input(sessionKey, data)
        return
      }
      if (data.includes('\x1b')) {
        lineBuffer = ''
        gt.pty.input(sessionKey, data)
        return
      }

      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          const rewritten = rewriteCodexSkillSubmit(lineBuffer, skillNames)
          const clearLine = '\x7f'.repeat(lineBuffer.length)
          lineBuffer = ''
          if (rewritten) {
            gt.pty.input(sessionKey, `${clearLine}${rewritten}`)
          } else {
            gt.pty.input(sessionKey, ch)
          }
          continue
        }
        if (ch === '\x7f') {
          lineBuffer = lineBuffer.slice(0, -1)
          gt.pty.input(sessionKey, ch)
          continue
        }
        if (ch === '\x03' || ch === '\x15') lineBuffer = ''
        else if (ch >= ' ') lineBuffer += ch
        gt.pty.input(sessionKey, ch)
      }
    }

    // Cmd+C / Cmd+V are handled natively by Electron's default Edit menu — don't
    // add a custom key handler too, or copy/paste fires twice (duplicates).
    // right-click: copy the selection if any, else paste (classic terminal UX).
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      if (term.hasSelection()) gt.clipboardWrite(term.getSelection())
      else gt.clipboardRead().then((t) => t && writeInput(t))
    }
    el.addEventListener('contextmenu', onContext)
    // attach listeners BEFORE starting the pty so no early output is missed.
    // Filter by sessionKey: every session's pty streams to all listeners.
    const offData = gt.pty.onData((key, d) => key === sessionKey && term.write(d))
    const offExit = gt.pty.onExit(
      (key) => key === sessionKey && term.write('\r\n\x1b[2m── process exited ──\x1b[0m\r\n'),
    )
    const onInput = term.onData(writeInput)

    // spawn the chosen engine attached to the session, sized to the live terminal
    gt.startSession(sessionKey, { ...choice, cols: term.cols, rows: term.rows }).then((info) => {
      onStarted?.(info)
      if (choice.initialInput) {
        window.setTimeout(() => gt.pty.input(sessionKey, choice.initialInput || ''), 900)
      }
    })

    // Debounce fit to a frame and only resize when the cell grid actually
    // changes — calling fit() synchronously inside the observer makes xterm
    // re-layout, which re-fires the observer ("ResizeObserver loop") and
    // thrashes the layout (visible flicker).
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const dims = fit.proposeDimensions()
        if (!dims || !dims.cols || !dims.rows) return
        if (dims.cols === term.cols && dims.rows === term.rows) return
        fit.fit()
        gt.pty.resize(sessionKey, { cols: term.cols, rows: term.rows })
      })
    })
    ro.observe(el)

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('contextmenu', onContext)
      offData()
      offExit()
      onInput.dispose()
      ro.disconnect()
      term.dispose()
      if (termRef.current === term) termRef.current = null
    }
  }, [])

  const groups = snippets.reduce<Record<string, PromptSnippet[]>>((acc, s) => {
    const group = s.group || 'Snippets'
    ;(acc[group] ||= []).push(s)
    return acc
  }, {})

  const inject = (prompt: string) => {
    window.gt.pty.input(sessionKey, prompt)
    setMenuOpen(false)
    requestAnimationFrame(() => termRef.current?.focus())
  }

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full px-2 py-1" />
      <div className="absolute right-2 top-2 z-20">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="Prompt snippets"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--gt-border)] bg-[var(--gt-bg)]/85 text-zinc-500 shadow-lg backdrop-blur hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
        >
          <MessageSquareText size={14} strokeWidth={2} />
        </button>
      </div>
      {menuOpen && (
        <div className="absolute inset-0 z-30" onClick={() => setMenuOpen(false)}>
          <div
            className="absolute right-2 top-10 w-[360px] max-w-[calc(100%-1rem)] overflow-hidden rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
              <MessageSquareText size={14} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
              <span className="text-[12px] font-semibold text-zinc-100">Snippets</span>
              <div className="flex-1" />
              <button
                onClick={() => setMenuOpen(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                title="Close"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
            <div className="max-h-[360px] overflow-y-auto p-2">
              {Object.entries(groups).map(([group, list]) => (
                <div key={group} className="mb-2 last:mb-0">
                  <div className="px-1.5 pb-1 text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">
                    {group}
                  </div>
                  <div className="space-y-1">
                    {list.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => inject(s.prompt)}
                        title={s.description || s.prompt}
                        className="flex w-full flex-col rounded-md border border-transparent px-2 py-1.5 text-left hover:border-[var(--gt-accent)]/50 hover:bg-white/5"
                      >
                        <span className="text-[12px] font-medium text-zinc-100">{s.title}</span>
                        <span className="line-clamp-2 text-[10.5px] leading-snug text-zinc-500">{s.prompt}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {snippets.length === 0 && (
                <div className="p-3 text-[12px] text-zinc-600">No snippets configured.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
