import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ClipboardCheck,
  ClipboardPaste,
  Copy,
  Eraser,
  EyeOff,
  FileText,
  Loader2,
  MessageSquareText,
  Play,
  Plus,
  Send,
  Sparkles,
  SquareDashedMousePointer,
  X,
  Search,
  Settings2,
} from 'lucide-react'
import { Terminal as Xterm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
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

type SuggestionMode = 'off' | 'deterministic' | 'ai'
type SuggestedReply = { label: string; prompt: string }

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

const withAlpha = (color: string, alpha: string, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(color.trim()) ? `${color.trim()}${alpha}` : fallback

const redactTerminalText = (text: string) =>
  text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'"\s]+/gi, '$1=[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g, '[redacted-token]')

function recentTerminalText(term: Xterm | null, maxLines = 180): string {
  if (!term) return ''
  const buffer = term.buffer.active
  const end = buffer.baseY + buffer.cursorY
  const start = Math.max(0, end - maxLines + 1)
  const lines: string[] = []
  for (let i = start; i <= end; i++) {
    const line = buffer.getLine(i)?.translateToString(true).trimEnd()
    if (line !== undefined) lines.push(line)
  }
  return redactTerminalText(lines.join('\n')).trim().slice(-14_000)
}

function deterministicReplies(output: string, engine: string): SuggestedReply[] {
  const lower = output.toLowerCase()
  const replies: SuggestedReply[] = []
  const add = (label: string, prompt: string) => {
    if (!replies.some((r) => r.prompt === prompt)) replies.push({ label, prompt })
  }

  if (/\b(do you want|would you like|should i|confirm|approve|continue|ready|waiting)\b/.test(lower)) {
    add('Continue', 'Looks good to me. Continue.')
  }
  if (/\b(error|failed|failure|traceback|exception|fatal|exit 1|denied|not found|typecheck|tsc)\b/.test(lower)) {
    add('Fix failure', 'Identify the root cause of the failure, apply the smallest safe fix, and rerun the relevant check.')
    add('Explain error', 'Explain the failure and the exact next command or code change you recommend.')
  }
  if (/\b(test|spec|suite|bun test|pytest|vitest|jest)\b/.test(lower)) {
    add('Run tests', 'Run the relevant test suite and fix any failures.')
  }
  if (/\b(done|implemented|rebuilt|released|pushed|committed|all set|complete|passed)\b/.test(lower)) {
    add('Summarize', 'Summarize what changed, what was verified, and any remaining risks.')
    add('Next step', 'Suggest the highest-leverage next step from here.')
  }
  add('Keep going', 'Continue with the next obvious step.')
  add('Check status', 'Check git status and summarize the current state.')
  if (engine !== 'local') add('Commit if ready', 'If the work is complete and verified, commit it with a concise conventional commit message.')
  return replies.slice(0, 5)
}

function parseAiReplies(text: string): SuggestedReply[] {
  const raw = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  const parsed = JSON.parse(raw) as { suggestions?: unknown }
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
  return suggestions
    .map((s): SuggestedReply | null => {
      if (typeof s === 'string') return { label: s.slice(0, 36), prompt: s }
      if (!s || typeof s !== 'object') return null
      const r = s as Record<string, unknown>
      const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : ''
      if (!prompt) return null
      const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : prompt.slice(0, 36)
      return { label: label.slice(0, 36), prompt }
    })
    .filter((s): s is SuggestedReply => !!s)
    .slice(0, 5)
}

function xtermThemeFromCss(): ITheme {
  const accent = cssVar('--gt-accent', '#7c6ef6')
  const lightMode = document.documentElement.dataset.gtMode === 'light'
  if (lightMode) {
    return {
      background: cssVar('--gt-terminal-bg', '#f6f7fb'),
      foreground: '#1f2937',
      cursor: accent,
      selectionBackground: withAlpha(accent, '33', 'rgba(101, 88, 232, 0.2)'),
      black: '#111827',
      red: '#b91c1c',
      green: '#166534',
      yellow: '#92400e',
      blue: '#1d4ed8',
      magenta: '#6d28d9',
      cyan: '#0f766e',
      white: '#475569',
      brightBlack: '#64748b',
      brightRed: '#dc2626',
      brightGreen: '#15803d',
      brightYellow: '#a16207',
      brightBlue: '#2563eb',
      brightMagenta: '#7c3aed',
      brightCyan: '#0d9488',
      brightWhite: '#0f172a',
    }
  }
  return {
    background: cssVar('--gt-terminal-bg', '#0a0a0f'),
    foreground: cssVar('--gt-terminal-fg', '#d4d4dd'),
    cursor: accent,
    selectionBackground: withAlpha(accent, '44', 'rgba(124, 110, 246, 0.28)'),
    black: cssVar('--gt-terminal-bg', '#0a0a0f'),
    red: cssVar('--gt-red', '#ef4444'),
    green: cssVar('--gt-green', '#8fca83'),
    yellow: cssVar('--gt-yellow', '#d7ba7d'),
    blue: cssVar('--gt-blue', '#7c9cff'),
    magenta: cssVar('--gt-accent-light', '#b58cff'),
    cyan: cssVar('--gt-accent-2', '#4fb3b8'),
    white: cssVar('--gt-text-muted', '#9ca3af'),
    brightBlack: cssVar('--gt-text-faint', '#4b5563'),
    brightRed: cssVar('--gt-red', '#f87171'),
    brightGreen: cssVar('--gt-green', '#a7d78d'),
    brightYellow: cssVar('--gt-yellow', '#e5cc8b'),
    brightBlue: cssVar('--gt-blue', '#9ab1ff'),
    brightMagenta: cssVar('--gt-accent-light', '#c7a6ff'),
    brightCyan: cssVar('--gt-accent-2', '#6fcbd0'),
    brightWhite: cssVar('--gt-text-soft', '#d4d4dd'),
  }
}

// Hosts the real Claude Code or Codex CLI: xterm.js renders, the PTY (main
// process) runs the chosen engine. Same pattern VS Code's integrated
// terminal uses.
export function TerminalPane({
  sessionKey,
  choice,
  onStarted,
  active = false,
  needsAttention = false,
  onClearAttention,
}: {
  sessionKey: string
  choice: Choice
  onStarted?: (info: { sessionId: string; cwd: string }) => void
  active?: boolean
  needsAttention?: boolean
  onClearAttention?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const termRef = useRef<Xterm | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const writeInputRef = useRef<(data: string) => void>(() => {})
  const [menuOpen, setMenuOpen] = useState(false)
  const [suggestionSettingsOpen, setSuggestionSettingsOpen] = useState(false)
  const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>('deterministic')
  const [suggestions, setSuggestions] = useState<SuggestedReply[]>([])
  const [suggestionBusy, setSuggestionBusy] = useState(false)
  const [suggestionErr, setSuggestionErr] = useState('')
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const isRemote = !!choice.remote

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => termRef.current?.focus())
  }, [active])

  const reloadSnippets = () => {
    if (isRemote) {
      setSnippets([])
      return Promise.resolve()
    }
    return window.gt.snippets
      .list(choice.cwd || '')
      .then((r) => setSnippets(r.snippets))
      .catch(() => setSnippets([]))
  }

  useEffect(() => {
    reloadSnippets()
    if (isRemote) {
      setSkills([])
      return
    }
    window.gt
      .listSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
    window.gt.settings.get().then((s) => setNewEngine(s.defaultEngine)).catch(() => {})
  }, [choice.cwd, isRemote])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const term = new Xterm({
      fontFamily: "'SF Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      minimumContrastRatio: 4.5,
      scrollback: 10000,
      theme: xtermThemeFromCss(),
    })
    termRef.current = term
    const fit = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(searchAddon)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.gt.openExternal(uri)))
    searchAddonRef.current = searchAddon
    term.open(el)
    fit.fit()

    const gt = window.gt
    let skillNames = new Set<string>(choice.engine === 'codex' && !isRemote ? ['ticket'] : [])
    if (choice.engine === 'codex' && !isRemote) {
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
    const onTheme = () => {
      term.options.theme = xtermThemeFromCss()
      term.options.minimumContrastRatio = 4.5
    }
    window.addEventListener('gt.theme.changed', onTheme)

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
    let fitTimer: number | undefined
    const refit = (force = false) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const dims = fit.proposeDimensions()
        if (!dims || !dims.cols || !dims.rows) return
        const changed = dims.cols !== term.cols || dims.rows !== term.rows
        if (!force && !changed) return
        fit.fit()
        if (changed) gt.pty.resize(sessionKey, { cols: term.cols, rows: term.rows })
        term.refresh(0, term.rows - 1)
      })
    }
    const onSettingsChanged = (e: Event) => {
      const appearance = (e as CustomEvent).detail?.appearance
      if (!appearance || appearance.uiScale === undefined) return
      refit(true)
      if (fitTimer) window.clearTimeout(fitTimer)
      fitTimer = window.setTimeout(() => refit(true), 80)
    }
    const ro = new ResizeObserver(() => refit())
    ro.observe(el)
    window.addEventListener('gt.settings.changed', onSettingsChanged)

    return () => {
      cancelAnimationFrame(raf)
      if (fitTimer) window.clearTimeout(fitTimer)
      el.removeEventListener('contextmenu', onContext)
      window.removeEventListener('gt.theme.changed', onTheme)
      window.removeEventListener('gt.settings.changed', onSettingsChanged)
      offData()
      offExit()
      onInput.dispose()
      ro.disconnect()
      term.dispose()
      if (termRef.current === term) termRef.current = null
      if (searchAddonRef.current === searchAddon) searchAddonRef.current = null
      writeInputRef.current = () => {}
    }
  }, [sessionKey, isRemote])

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
    setSuggestionSettingsOpen(false)
    requestAnimationFrame(() => termRef.current?.focus())
  }
  const runSuggestion = (prompt: string) => {
    window.gt.pty.input(sessionKey, `${prompt}\r`)
    setSuggestions([])
    setSuggestionErr('')
    onClearAttention?.()
    requestAnimationFrame(() => termRef.current?.focus())
  }
  const generateSuggestions = async (mode: SuggestionMode = suggestionMode) => {
    setSuggestionsDismissed(false)
    if (mode === 'off') {
      setSuggestions([])
      setSuggestionBusy(false)
      setSuggestionErr('')
      return
    }
    const output = recentTerminalText(termRef.current)
    const fallback = deterministicReplies(output, choice.engine)
    if (mode === 'deterministic') {
      setSuggestions(fallback)
      setSuggestionBusy(false)
      setSuggestionErr('')
      return
    }

    setSuggestionBusy(true)
    setSuggestionErr('')
    setSuggestions([])
    const r = await window.gt.cheapLlm({
      route: 'claude-p',
      model: 'haiku',
      maxTokens: 650,
      temperature: 0.2,
      timeoutMs: 18_000,
      messages: [
        {
          role: 'system',
          content:
            'You generate likely next human replies for an AI coding terminal. Reply only JSON: {"suggestions":[{"label":"short button label","prompt":"text to paste and submit"}]}. Return 1-5 concise, actionable replies. Do not include markdown.',
        },
        {
          role: 'user',
          content:
            `Engine: ${choice.engine}\nDirectory: ${choice.cwd || '(unknown)'}\n\nRecent terminal output:\n\n` +
            '```\n' +
            output +
            '\n```',
        },
      ],
    })
    setSuggestionBusy(false)
    if (!r.ok || !r.text) {
      setSuggestionErr(r.error || 'AI suggestions unavailable')
      setSuggestions(fallback)
      return
    }
    try {
      const parsed = parseAiReplies(r.text)
      setSuggestions(parsed.length ? parsed : fallback)
    } catch {
      setSuggestionErr('AI returned unreadable suggestions')
      setSuggestions(fallback)
    }
  }
  const selectedText = () => termRef.current?.getSelection().trim() || ''
  const agentEngine = (): Engine =>
    choice.engine === 'claude' || choice.engine === 'codex' || choice.engine === 'cursor'
      ? choice.engine
      : newEngine
  const focusTerminalSoon = () => requestAnimationFrame(() => termRef.current?.focus())
  const searchOptions = {
    caseSensitive: false,
    decorations: {
      matchBackground: '#3f3f46',
      matchOverviewRuler: '#a1a1aa',
      activeMatchBackground: cssVar('--gt-accent', '#7c6ef6'),
      activeMatchColorOverviewRuler: cssVar('--gt-accent', '#7c6ef6'),
    },
  }
  const findInScrollback = (direction: 'next' | 'previous') => {
    const q = searchQuery.trim()
    if (!q) return
    const addon = searchAddonRef.current
    if (direction === 'previous') addon?.findPrevious(q, searchOptions)
    else addon?.findNext(q, searchOptions)
  }
  const openSearch = () => {
    setSearchOpen(true)
    requestAnimationFrame(() => searchInputRef.current?.select())
  }
  const closeSearch = () => {
    searchAddonRef.current?.clearDecorations()
    setSearchOpen(false)
    focusTerminalSoon()
  }
  const closeContextMenu = () => {
    setContextMenu(null)
    focusTerminalSoon()
  }
  const terminalOutputPrompt = (task: string, text: string) =>
    `${task}\n\nTerminal output:\n\n\`\`\`\n${text}\n\`\`\``
  const sendSelectionToAgent = (task: string, name: string, sameSession = false) => {
    const text = selectedText()
    if (!text) return
    const prompt = terminalOutputPrompt(task, text)
    setContextMenu(null)
    const engine = agentEngine()
    if (sameSession && choice.engine === engine) {
      inject(prompt, true)
      return
    }
    openPromptInTerminal({
      engine,
      cwd: choice.cwd || '',
      name,
      prompt,
      remote: choice.remote,
    })
  }
  const copySelectionAsPrompt = () => {
    const text = selectedText()
    if (!text) return
    window.gt.clipboardWrite(terminalOutputPrompt('Analyze this terminal output.', text))
    closeContextMenu()
  }
  const startSnippetFromSelection = () => {
    const text = selectedText()
    if (!text || isRemote) return
    setDraft({
      title: 'Terminal output',
      group: 'Terminal',
      prompt: text,
    })
    setNewScope('repo')
    setNewMode('custom')
    setNewOpen(true)
    setContextMenu(null)
  }
  const hidePresetSnippet = async (id: string) => {
    await window.gt.presets.hide('snippets', id)
    await reloadSnippets()
  }
  const showSuggestions = needsAttention && suggestionMode !== 'off' && !suggestionsDismissed
  const suggestionsPanelHeight = 'min(220px, 34vh)'

  useEffect(() => {
    if (!needsAttention) return
    setSuggestionsDismissed(false)
    generateSuggestions(suggestionMode)
    // Generate once when this terminal enters an attention state or the local
    // mode changes. The function reads live xterm scrollback at that moment.
  }, [needsAttention, suggestionMode])

  useEffect(() => {
    if (!active || !needsAttention || suggestionMode === 'off' || suggestionsDismissed) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const editing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (editing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 5) return
      const suggestion = suggestions[n - 1]
      if (!suggestion) return
      e.preventDefault()
      runSuggestion(suggestion.prompt)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, needsAttention, suggestionMode, suggestionsDismissed, suggestions])

  useEffect(() => {
    if (!searchOpen) return
    requestAnimationFrame(() => searchInputRef.current?.select())
  }, [searchOpen])

  useEffect(() => {
    if (!searchOpen) {
      searchAddonRef.current?.clearDecorations()
      return
    }
    const q = searchQuery.trim()
    if (!q) {
      searchAddonRef.current?.clearDecorations()
      return
    }
    searchAddonRef.current?.findNext(q, { ...searchOptions, incremental: true })
  }, [searchOpen, searchQuery])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const editing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && (!editing || searchOpen)) {
        e.preventDefault()
        openSearch()
        return
      }
      if (!searchOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSearch()
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        findInScrollback(e.shiftKey ? 'previous' : 'next')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, searchOpen, searchQuery])

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
      remote: choice.remote,
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
    <div className="relative h-full w-full overflow-hidden bg-[var(--gt-terminal-bg)]">
      <div
        className="absolute inset-x-0 top-0 overflow-hidden p-3"
        style={{ bottom: showSuggestions ? suggestionsPanelHeight : 0 }}
      >
        <div ref={ref} className="h-full w-full overflow-hidden" />
      </div>
      <div className={`absolute top-4 z-20 ${isRemote ? 'right-14' : 'right-24'}`}>
        <button
          onClick={openSearch}
          title="Find in scrollback"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--gt-border)] bg-[var(--gt-bg)]/90 text-zinc-500 shadow-lg backdrop-blur hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
        >
          <Search size={14} strokeWidth={2} />
        </button>
      </div>
      <div className={`absolute top-4 z-20 ${isRemote ? 'right-4' : 'right-14'}`}>
        <button
          onClick={() => setSuggestionSettingsOpen((v) => !v)}
          title="Suggested replies"
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border shadow-lg backdrop-blur ${
            suggestionMode === 'off'
              ? 'border-[var(--gt-border)] bg-[var(--gt-bg)]/90 text-zinc-600 hover:border-[var(--gt-accent)]/60 hover:text-zinc-300'
              : needsAttention
                ? 'border-[var(--gt-yellow)]/50 bg-[var(--gt-yellow)]/10 text-[var(--gt-yellow)]'
                : 'border-[var(--gt-border)] bg-[var(--gt-bg)]/90 text-zinc-500 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100'
          }`}
        >
          <Settings2 size={14} strokeWidth={2} />
        </button>
      </div>
      {!isRemote && (
      <div className="absolute right-4 top-4 z-20">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="Prompt snippets"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--gt-border)] bg-[var(--gt-bg)]/90 text-zinc-500 shadow-lg backdrop-blur hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
        >
          <MessageSquareText size={14} strokeWidth={2} />
        </button>
      </div>
      )}
      {suggestionSettingsOpen && (
        <div className={`absolute top-14 z-30 w-64 rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)]/95 p-2 shadow-2xl backdrop-blur ${isRemote ? 'right-4' : 'right-14'}`}>
          <div className="mb-1.5 flex items-center gap-2 px-1">
            <Sparkles size={13} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
            <span className="text-[11px] font-semibold text-zinc-200">Suggested replies</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(['off', 'deterministic', 'ai'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setSuggestionMode(mode)
                  setSuggestionSettingsOpen(false)
                }}
                className={`rounded-md border px-2 py-1.5 text-[10.5px] font-semibold capitalize ${
                  suggestionMode === mode
                    ? 'border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/20 text-zinc-100'
                    : 'border-[var(--gt-border)] bg-black/20 text-zinc-500 hover:text-zinc-200'
                }`}
              >
                {mode === 'deterministic' ? 'Rules' : mode}
              </button>
            ))}
          </div>
          <div className="mt-2 rounded-md border border-[var(--gt-border)] bg-black/20 px-2 py-1.5 text-[10.5px] leading-4 text-zinc-500">
            AI uses local <span className="font-mono text-zinc-400">claude -p haiku</span> only; it will not fall back to OpenRouter.
          </div>
        </div>
      )}
      {showSuggestions && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 border-t border-[var(--gt-border)] bg-[var(--gt-panel)]/95 p-2 shadow-[0_-12px_28px_rgba(0,0,0,0.22)] backdrop-blur"
          style={{ height: suggestionsPanelHeight }}
        >
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={13} strokeWidth={2} className={suggestionBusy ? 'animate-pulse text-[var(--gt-yellow)]' : 'text-[var(--gt-accent-light)]'} />
            <span className="text-[11px] font-semibold text-zinc-200">Suggested next replies</span>
            <span className="text-[10.5px] text-zinc-600">1-5 to send</span>
            <span className="rounded bg-black/25 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-zinc-600">
              {suggestionMode === 'ai' ? 'Haiku' : 'Rules'}
            </span>
            {suggestionBusy && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-zinc-500">
                <Loader2 size={11} strokeWidth={2} className="animate-spin" />
                reading terminal
              </span>
            )}
            {suggestionErr && <span className="truncate text-[10.5px] text-[var(--gt-yellow)]">{suggestionErr}</span>}
            <div className="flex-1" />
            <button
              onClick={() => generateSuggestions(suggestionMode)}
              disabled={suggestionBusy}
              className="rounded-md px-1.5 py-0.5 text-[10.5px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40"
            >
              Refresh
            </button>
            <button
              onClick={() => setSuggestionsDismissed(true)}
              title="Dismiss suggestions"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
          {suggestionBusy && suggestions.length === 0 ? (
            <div className="grid gap-1.5 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-white/5" />
              ))}
            </div>
          ) : (
            <div className="grid max-h-[calc(100%-28px)] gap-1.5 overflow-y-auto lg:grid-cols-2">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.label}-${i}`}
                  onClick={() => runSuggestion(s.prompt)}
                  title={s.prompt}
                  className="group flex min-w-0 items-start gap-2 rounded-md border border-[var(--gt-border)] bg-black/20 px-2.5 py-2 text-left hover:border-[var(--gt-accent)]/60 hover:bg-[var(--gt-accent)]/10"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--gt-accent)]/15 text-[var(--gt-accent-light)]">
                    <span className="text-[10px] font-bold tabular-nums">{i + 1}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="mb-1 block text-[11.5px] font-semibold text-zinc-200">{s.label}</span>
                    <span className="block whitespace-pre-wrap break-words text-[10.5px] leading-4 text-zinc-500 group-hover:text-zinc-400">{s.prompt}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {searchOpen && (
        <div className="absolute right-4 top-14 z-30 flex w-[min(360px,calc(100%-2rem))] items-center gap-1 rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)]/95 p-1.5 shadow-2xl backdrop-blur">
          <Search size={13} strokeWidth={2} className="ml-1 shrink-0 text-zinc-500" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                findInScrollback(e.shiftKey ? 'previous' : 'next')
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                closeSearch()
              }
            }}
            placeholder="Find in scrollback..."
            className="h-7 min-w-0 flex-1 bg-transparent px-1 text-[12px] text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <button
            onClick={() => findInScrollback('previous')}
            title="Previous match"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <ChevronUp size={13} strokeWidth={2} />
          </button>
          <button
            onClick={() => findInScrollback('next')}
            title="Next match"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button
            onClick={closeSearch}
            title="Close find"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      )}
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
              closeContextMenu()
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          >
            <ClipboardPaste size={13} strokeWidth={2} />
            Paste
          </button>
          <button
            onClick={() => {
              window.gt.clipboardRead().then((text) => {
                if (text) writeInputRef.current(`${text}\r`)
              })
              closeContextMenu()
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          >
            <Play size={13} strokeWidth={2} />
            Paste and run
          </button>
          <div className="my-1 border-t border-[var(--gt-border)]/60" />
          <button
            disabled={!contextMenu.hasSelection}
            onClick={copySelectionAsPrompt}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
          >
            <ClipboardCheck size={13} strokeWidth={2} />
            Copy as prompt
          </button>
          <button
            disabled={!contextMenu.hasSelection}
            onClick={() =>
              sendSelectionToAgent(
                'Explain what happened, identify likely causes, and suggest the next command or code change.',
                'Explain terminal output',
                true,
              )
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
          >
            <Send size={13} strokeWidth={2} />
            Send to agent
          </button>
          <button
            disabled={!contextMenu.hasSelection}
            onClick={() =>
              sendSelectionToAgent(
                'Debug this terminal output. Be concrete: name the failing command, root cause, and exact fix.',
                'Debug terminal output',
              )
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
          >
            <Sparkles size={13} strokeWidth={2} />
            Debug in new agent
          </button>
          <button
            disabled={!contextMenu.hasSelection}
            onClick={() =>
              sendSelectionToAgent(
                'File exactly one backlog ticket for the issue implied by this terminal output. Include reproduction context and acceptance criteria. Do not implement it.',
                'File ticket from terminal',
              )
            }
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
          >
            <FileText size={13} strokeWidth={2} />
            File ticket from selection
          </button>
          {!isRemote && (
            <button
              disabled={!contextMenu.hasSelection}
              onClick={startSnippetFromSelection}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
            >
              <MessageSquareText size={13} strokeWidth={2} />
              Save as snippet
            </button>
          )}
          <div className="my-1 border-t border-[var(--gt-border)]/60" />
          <button
            onClick={() => {
              termRef.current?.selectAll()
              closeContextMenu()
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          >
            <SquareDashedMousePointer size={13} strokeWidth={2} />
            Select all
          </button>
          <button
            onClick={() => {
              termRef.current?.clear()
              closeContextMenu()
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5"
          >
            <Eraser size={13} strokeWidth={2} />
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
