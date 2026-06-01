import { useEffect, useRef, useState } from 'react'
import { Bot, Clipboard, ClipboardPaste, Copy, EyeOff, MessageSquareText, Play, Plus, Search, X } from 'lucide-react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { Choice } from './EntryScreen'
import type { Engine, PromptSnippet, SkillInfo } from '../lib/types'
import { rewriteCodexSkillSubmit } from '../lib/codexSkillInput'
import { EngineLogo } from './EngineLogo'
import { EngineModelPicker } from './EngineModelPicker'
import { engineInstanceLabel, openPromptInTerminal, type LaunchMode } from '../lib/launch'

type LauncherItem =
  | {
      kind: 'snippet'
      id: string
      title: string
      subtitle: string
      prompt: string
      group: string
      source?: PromptSnippet['source']
    }
  | { kind: 'skill'; id: string; title: string; subtitle: string; prompt: string; group: string }

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
  const writeInputRef = useRef<(data: string) => void>(() => {})
  const [menuOpen, setMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    hasSelection: boolean
  } | null>(null)
  const [snippets, setSnippets] = useState<PromptSnippet[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [query, setQuery] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newMode, setNewMode] = useState<'ai' | 'custom'>('ai')
  const [newScope, setNewScope] = useState<'repo' | 'global'>('repo')
  const [newEngine, setNewEngine] = useState<Engine>('claude')
  const [newModel, setNewModel] = useState<string | undefined>(undefined)
  const [newLaunchMode, setNewLaunchMode] = useState<LaunchMode>('terminal')
  const [newText, setNewText] = useState('')
  const [draft, setDraft] = useState({ title: '', group: 'Custom', prompt: '' })
  const [newBusy, setNewBusy] = useState(false)
  const [newErr, setNewErr] = useState('')

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => termRef.current?.focus())
  }, [active])

  const reloadSnippets = () =>
    window.gt.snippets
      .list(choice.cwd || '')
      .then((r) => setSnippets(r.snippets))
      .catch(() => setSnippets([]))

  useEffect(() => {
    reloadSnippets()
    window.gt
      .listSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
    window.gt.settings.get().then((s) => setNewEngine(s.defaultEngine)).catch(() => {})
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
        foreground: '#d4d4dd',
        cursor: '#7c5cff',
        selectionBackground: '#7c5cff44',
        black: '#0a0a0f',
        red: '#ef4444',
        green: '#8fca83',
        yellow: '#d7ba7d',
        blue: '#7c9cff',
        magenta: '#b58cff',
        cyan: '#4fb3b8',
        white: '#9ca3af',
        brightBlack: '#4b5563',
        brightRed: '#f87171',
        brightGreen: '#a7d78d',
        brightYellow: '#e5cc8b',
        brightBlue: '#9ab1ff',
        brightMagenta: '#c7a6ff',
        brightCyan: '#6fcbd0',
        brightWhite: '#d4d4dd',
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
    writeInputRef.current = writeInput

    // Cmd+C / Cmd+V are handled natively by Electron's default Edit menu — don't
    // add a custom key handler too, or copy/paste fires twice (duplicates).
    // Right-click opens an explicit terminal menu. The old copy-or-paste
    // behavior worked, but it felt like a dead click because it had no UI.
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, hasSelection: term.hasSelection() })
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
      writeInputRef.current = () => {}
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  const commandForSkill = (s: SkillInfo) => {
    if (choice.engine === 'codex') return s.platforms.includes('codex') ? `$${s.name} ` : ''
    if (choice.engine === 'claude') return s.platforms.includes('claude') ? `/${s.name} ` : ''
    return ''
  }
  const items: LauncherItem[] = [
    ...snippets.map((s) => ({
      kind: 'snippet' as const,
      id: s.id,
      title: s.title,
      subtitle: s.prompt,
      prompt: s.prompt,
      group: s.group || 'Snippets',
      source: s.source,
    })),
    ...skills
      .map((s) => ({ skill: s, prompt: commandForSkill(s) }))
      .filter((s) => s.prompt)
      .map(({ skill, prompt }) => ({
        kind: 'skill' as const,
        id: `${skill.scope}:${skill.namespace || ''}:${skill.name}`,
        title: `${prompt.trim()}`,
        subtitle: skill.description || `${skill.scope}${skill.namespace ? ` · ${skill.namespace}` : ''}`,
        prompt,
        group: `Skills · ${skill.scope}${skill.namespace ? ` · ${skill.namespace}` : ''}`,
      })),
  ]

  const filtered = items.filter((s) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [s.title, s.prompt, s.subtitle, s.group].some((v) => v.toLowerCase().includes(q))
  })

  const groups = filtered.reduce<Record<string, LauncherItem[]>>((acc, s) => {
    ;(acc[s.group] ||= []).push(s)
    return acc
  }, {})

  const inject = (prompt: string, run = false) => {
    window.gt.pty.input(sessionKey, run ? `${prompt}\r` : prompt)
    setMenuOpen(false)
    requestAnimationFrame(() => termRef.current?.focus())
  }
  const hidePresetSnippet = async (id: string) => {
    await window.gt.presets.hide('snippets', id)
    await reloadSnippets()
  }

  const draftWithAi = async () => {
    const text = newText.trim()
    if (!text) return
    setNewBusy(true)
    setNewErr('')
    const r = await window.gt.cheapLlm({
      route: 'auto',
      model: 'haiku',
      maxTokens: 700,
      messages: [
        {
          role: 'system',
          content:
            'Create one TerMinal prompt snippet. Reply only JSON with keys title, group, prompt, description. The prompt should be concise and directly pasteable into Claude Code or Codex.',
        },
        { role: 'user', content: text },
      ],
    })
    setNewBusy(false)
    if (!r.ok || !r.text) {
      setNewErr(r.error || 'AI draft failed')
      return
    }
    try {
      const raw = r.text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
      const json = JSON.parse(raw) as Partial<PromptSnippet>
      setDraft({ title: json.title || '', group: json.group || 'Custom', prompt: json.prompt || '' })
    } catch {
      setDraft({ title: text.slice(0, 48), group: 'Custom', prompt: r.text.trim() })
    }
  }

  const draftSnippetInTerminal = () => {
    const text = newText.trim()
    if (!text) return
    const target =
      newScope === 'global'
        ? '~/.config/TerMinal/snippets.json'
        : `${choice.cwd || '<repo root>'}/.TerMinal/snippets.json`
    openPromptInTerminal({
      engine: newEngine,
      cwd: choice.cwd || '',
      name: 'New snippet',
      prompt:
        `Create a new TerMinal prompt snippet from this request:\n\n${text}\n\n` +
        `Save it to ${target}. Preserve existing snippets and upsert one entry using this schema:\n` +
        `{\n  "version": 2,\n  "snippets": [\n    { "id": "kebab-id", "title": "Short title", "group": "Group", "description": "Optional short description", "prompt": "Pasteable prompt text" }\n  ]\n}\n\n` +
        `Scope: ${newScope}. Preferred model: ${newModel || 'engine default'}. Commit the change if this repo normally commits TerMinal metadata, then summarize what you saved.`,
    })
    setNewOpen(false)
    setMenuOpen(false)
  }

  const saveDraft = async () => {
    setNewBusy(true)
    setNewErr('')
    const r = await window.gt.snippets.save({
      scope: newScope,
      repoRoot: choice.cwd || '',
      snippet: draft,
    })
    setNewBusy(false)
    if ('error' in r) {
      setNewErr(r.error)
      return
    }
    setDraft({ title: '', group: 'Custom', prompt: '' })
    setNewText('')
    setNewMode('ai')
    setNewOpen(false)
    await reloadSnippets()
  }

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full px-2 py-1" />
      <div className="absolute right-5 top-2 z-20">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="Prompt snippets"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--gt-border)] bg-[var(--gt-bg)]/85 text-zinc-500 shadow-lg backdrop-blur hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
        >
          <MessageSquareText size={14} strokeWidth={2} />
        </button>
      </div>
      {contextMenu && (
        <div
          className="fixed z-[70] min-w-40 overflow-hidden rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] py-1 text-[12px] text-zinc-200 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            disabled={!contextMenu.hasSelection}
            onClick={() => {
              const text = termRef.current?.getSelection() || ''
              if (text) window.gt.clipboardWrite(text)
              setContextMenu(null)
              requestAnimationFrame(() => termRef.current?.focus())
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
          >
            <Copy size={13} strokeWidth={2} />
            Copy
          </button>
          <button
            onClick={() => {
              window.gt.clipboardRead().then((text) => {
                if (text) writeInputRef.current(text)
              })
              setContextMenu(null)
              requestAnimationFrame(() => termRef.current?.focus())
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          >
            <ClipboardPaste size={13} strokeWidth={2} />
            Paste
          </button>
          <button
            onClick={() => {
              termRef.current?.selectAll()
              setContextMenu(null)
              requestAnimationFrame(() => termRef.current?.focus())
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          >
            Select all
          </button>
          <button
            onClick={() => {
              termRef.current?.clear()
              setContextMenu(null)
              requestAnimationFrame(() => termRef.current?.focus())
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          >
            Clear scrollback
          </button>
        </div>
      )}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6" onClick={() => setMenuOpen(false)}>
          <div
            className="mt-8 flex max-h-[82vh] w-[760px] max-w-full flex-col overflow-hidden rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[var(--gt-border)] px-3 py-2">
              <MessageSquareText size={15} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
              <span className="text-[12px] font-semibold text-zinc-100">Launcher</span>
              <div className="relative ml-2 min-w-0 flex-1">
                <Search size={13} strokeWidth={2} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                  placeholder="Search snippets and skills..."
                  className="h-7 w-full rounded-md border border-[var(--gt-border)] bg-black/30 py-1 pl-7 pr-2 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                />
              </div>
              <button
                onClick={() => {
                  setNewMode('ai')
                  setNewOpen(true)
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2 text-[11px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20"
              >
                <Plus size={13} strokeWidth={2.5} />
                New
              </button>
              <button
                onClick={() => setMenuOpen(false)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                title="Close"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {Object.entries(groups).map(([group, list]) => (
                <div key={group} className="mb-2 last:mb-0">
                  <div className="sticky top-0 z-10 border-b border-[var(--gt-border)]/50 bg-[var(--gt-panel)] px-1.5 py-1 text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">
                    {group}
                  </div>
                  <div className="divide-y divide-[var(--gt-border)]/45">
                    {list.map((s) => (
                      <div
                        key={s.id}
                        title={s.subtitle || s.prompt}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-1.5 py-1.5 hover:bg-white/5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`shrink-0 rounded px-1 py-px text-[8.5px] font-bold uppercase tracking-wide ${
                              s.kind === 'skill'
                                ? 'bg-[var(--gt-blue)]/15 text-[var(--gt-blue)]'
                                : 'bg-[var(--gt-accent)]/15 text-[var(--gt-accent-light)]'
                            }`}
                          >
                            {s.kind}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-zinc-100">{s.title}</div>
                            <div className="truncate text-[10.5px] text-zinc-500">{s.subtitle}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 justify-end gap-1">
                          {s.kind === 'snippet' && s.source === 'preset' && (
                            <button
                              onClick={() => hidePresetSnippet(s.id)}
                              title="Hide preset"
                              className="inline-flex h-6 w-7 items-center justify-center rounded-md border border-[var(--gt-border)] text-zinc-500 hover:border-[var(--gt-yellow)]/60 hover:text-[var(--gt-yellow)]"
                            >
                              <EyeOff size={11} strokeWidth={2} />
                            </button>
                          )}
                          <button
                            onClick={() => inject(s.prompt, false)}
                            title="Insert"
                            className="inline-flex h-6 w-7 items-center justify-center rounded-md border border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
                          >
                            <Clipboard size={11} strokeWidth={2} />
                          </button>
                          <button
                            onClick={() => inject(s.prompt, true)}
                            title="Insert and run"
                            className="inline-flex h-6 w-7 items-center justify-center rounded-md bg-[var(--gt-accent)] text-white hover:opacity-90"
                          >
                            <Play size={11} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="p-8 text-center text-[12px] text-zinc-600">No snippets match.</div>
              )}
            </div>
          </div>
        </div>
      )}
      {newOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={() => setNewOpen(false)}>
          <div
            className="flex max-h-[86vh] w-[680px] flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Bot size={15} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
              <h2 className="text-sm font-bold text-zinc-100">New snippet</h2>
              <div className="flex-1" />
              <button onClick={() => setNewOpen(false)} className="rounded-md p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="flex w-fit items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
              {(['ai', 'custom'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setNewMode(mode)}
                  className={`rounded-sm px-2.5 py-1 text-[11px] font-semibold ${
                    newMode === mode ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {mode === 'ai' ? 'AI' : 'Custom'}
                </button>
              ))}
            </div>
            {newMode === 'ai' ? (
              <>
                <textarea
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder='Describe the snippet you want, e.g. "run the test suite and fix failures"'
                  className="resize-y rounded-md border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12.5px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
                    {(['repo', 'global'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setNewScope(s)}
                        className={`rounded-sm px-2 py-1 text-[11px] ${
                          newScope === s ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {s === 'repo' ? 'This repo' : 'Global'}
                      </button>
                    ))}
                  </div>
                  <EngineModelPicker
                    engine={newEngine}
                    model={newModel}
                    onChange={(e, m) => {
                      setNewEngine(e)
                      setNewModel(m)
                    }}
                    size="sm"
                  />
                  <select
                    value={newLaunchMode}
                    onChange={(e) => setNewLaunchMode(e.target.value as LaunchMode)}
                    className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
                  >
                    <option value="terminal">{engineInstanceLabel(newEngine)} instance</option>
                    <option value="process">Process</option>
                  </select>
                  <button
                    onClick={newLaunchMode === 'terminal' ? draftSnippetInTerminal : draftWithAi}
                    disabled={!newText.trim() || newBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--gt-accent-light)] disabled:opacity-40"
                  >
                    {newBusy ? <Bot size={12} strokeWidth={2} /> : <EngineLogo engine={newEngine} size={12} />}
                    {newBusy ? 'Drafting...' : newLaunchMode === 'terminal' ? 'Open instance' : 'Draft with AI'}
                  </button>
                </div>
                {(draft.title || draft.prompt) && (
                  <div className="rounded-md border border-[var(--gt-border)] bg-black/20 p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-100">
                        {draft.title || 'Untitled snippet'}
                      </span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">{draft.group || 'Custom'}</span>
                      <button
                        onClick={() => setNewMode('custom')}
                        className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-5 text-zinc-400">{draft.prompt}</div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
                    {(['repo', 'global'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setNewScope(s)}
                        className={`rounded-sm px-2 py-1 text-[11px] ${
                          newScope === s ? 'bg-[var(--gt-accent)]/20 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {s === 'repo' ? 'This repo' : 'Global'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    autoFocus
                    placeholder="Title"
                    className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                  />
                  <input
                    value={draft.group}
                    onChange={(e) => setDraft((d) => ({ ...d, group: e.target.value }))}
                    placeholder="Group"
                    className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                  />
                </div>
                <textarea
                  value={draft.prompt}
                  onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                  rows={7}
                  placeholder="Prompt to insert"
                  className="resize-y rounded-md border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12.5px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
                />
              </>
            )}
            <div className="flex items-center gap-2">
              {newErr && <span className="text-[11px] text-[var(--gt-red)]">{newErr}</span>}
              <div className="flex-1" />
              <button onClick={() => setNewOpen(false)} className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5">
                Cancel
              </button>
              <button
                onClick={saveDraft}
                disabled={!draft.title.trim() || !draft.prompt.trim() || newBusy}
                className="rounded-md bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                Save snippet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
