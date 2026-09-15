import { useEffect, useReducer } from 'react'
import { Bot } from 'lucide-react'
import { EngineLogo } from '../../components/EngineLogo'
import { EngineModelPicker } from '../../components/EngineModelPicker'
import { SkillHint } from '../../components/SkillHint'
import { Dialog, DialogContent } from '../../components/ui/dialog'
import { engineLabel } from '../../lib/engines'
import { engineInstanceLabel, openPromptInTerminal, type LaunchMode } from '../../lib/launch'
import type { AgentRun, Engine, TabContext } from '../../lib/types'

// Add an agent by describing it: the selected engine reads the repo's
// conventions and writes the spec. Saving writes <repo>/.agents/agents.json
// (overriding a built-in default = same id).

type Form = {
  text: string
  engine: Engine
  model: string | undefined
  launchMode: LaunchMode
  scope: 'repo' | 'global'
  busy: boolean
  err: string
}

const INITIAL: Form = {
  text: '',
  engine: 'codex',
  model: undefined,
  launchMode: 'terminal',
  scope: 'repo',
  busy: false,
  err: '',
}

function reduce(state: Form, patch: Partial<Form>): Form {
  return { ...state, ...patch }
}

const TEMPLATES = [
  {
    label: 'Precheck + escalate',
    text: 'A scheduled agent that runs a deterministic precheck first (tsc, tests, lint) and only escalates to an LLM when something fails. On failure, diagnose the failures and apply a small surgical fix if safe, else file a backlog ticket. Default model: haiku.',
  },
  {
    label: 'Single LLM call',
    text: 'A simple agent that runs a single selected-engine prompt to … (fill in the task). Opens a PR with the result. Default model: sonnet.',
  },
  {
    label: 'Pure deterministic',
    text: 'A pure shell agent (no LLM) that runs … (fill in the check), files an Inbox item via terminal-cli only if a probe fails, and emits an activity event with the summary on success.',
  },
] as const

export function AgentDesigner({
  repoRoot,
  remote,
  onClose,
  onSpawned,
  onAdvanced,
}: {
  repoRoot: string
  remote?: TabContext['remoteSession']
  onClose: () => void
  onSpawned: (run: AgentRun) => void
  onAdvanced: () => void
}) {
  const [form, set] = useReducer(reduce, INITIAL)
  const { text, engine, model, launchMode, scope, busy, err } = form

  useEffect(() => {
    window.gt.settings.get().then((s) => set({ engine: s.defaultEngine }))
  }, [])

  const submit = async () => {
    const t = text.trim()
    if (!t) return
    if (launchMode === 'terminal') {
      openPromptInTerminal({
        engine,
        cwd: repoRoot,
        name: 'Design agent',
        prompt: `Design a new TerMinal agent for this repository from this request:\n\n${t}\n\nWrite the agent files according to this repo's .agents conventions, commit the result, and summarize what you created.`,
        remote,
      })
      onClose()
      return
    }
    set({ busy: true, err: '' })
    const r = await window.gt.agents.design(t, engine, scope, model)
    set({ busy: false })
    if (r && 'error' in r) {
      set({ err: r.error })
      return
    }
    onSpawned(r as AgentRun)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[86vh] w-[640px] flex-col gap-3 overflow-y-auto rounded-2xl bg-[var(--gt-panel)] p-5"
      >
        <div className="flex items-center gap-2">
          <Bot size={16} strokeWidth={2} className="text-[var(--gt-accent-light)]" />
          <h2 className="text-sm font-bold text-zinc-100">New agent</h2>
          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-zinc-500">
            Describe what it does —
            <EngineLogo engine={engine} size={11} />
            {engineLabel(engine)} writes the prompt + saves it
          </span>
        </div>
        <SkillHint>
          You can also ask from the terminal with{' '}
          <code className="font-mono text-zinc-300">/new-agent "Create me an agent that …"</code> in
          Claude or{' '}
          <code className="font-mono text-zinc-300">$new-agent "Create me an agent that …"</code> in
          Codex.
        </SkillHint>
        <label className="flex flex-col gap-1">
          <div className="flex items-end justify-between">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">
              Description
            </span>
            {/* Templates — single click prefills the textarea with a starting
                description that nudges the designer toward a specific shape. */}
            <div className="flex items-center gap-1 text-[10px] text-zinc-600">
              <span>Start from:</span>
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => set({ text: t.text })}
                  className="rounded-md border border-[var(--gt-border)] px-1.5 py-0.5 hover:border-[var(--gt-accent)]/60 hover:text-zinc-300"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => set({ text: e.target.value })}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
            }}
            rows={5}
            autoFocus
            placeholder={
              'e.g. An agent that scans the repo for any TODO/FIXME older than 90 days, files a ticket per cluster, and opens a PR only if it can safely clean up the matching comments without changing behavior. Run weekly.'
            }
            className="resize-none rounded-md border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[12.5px] text-zinc-200 placeholder:text-zinc-600 focus:border-[var(--gt-accent)]/60 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Scope</span>
            <div className="flex items-center gap-0.5 rounded-md border border-[var(--gt-border)] p-0.5">
              {(
                [
                  { id: 'repo', label: 'This repo' },
                  { id: 'global', label: 'Global' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  onClick={() => set({ scope: s.id })}
                  title={
                    s.id === 'repo'
                      ? "Save to this repo's .agents/agents.json"
                      : 'Save to the global registry (~/.config/TerMinal/agents/global.json)'
                  }
                  className={`rounded-sm px-2 py-1 text-[11px] ${
                    scope === s.id
                      ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">
              Engine + model
            </span>
            <EngineModelPicker
              engine={engine}
              model={model}
              onChange={(e, m) => set({ engine: e, model: m })}
              size="sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Launch</span>
            <select
              value={launchMode}
              onChange={(e) => set({ launchMode: e.target.value as LaunchMode })}
              className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60 disabled:opacity-50"
            >
              <option value="terminal">{engineInstanceLabel(engine)} instance</option>
              <option value="process">Process</option>
            </select>
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onAdvanced}
              className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300"
              title="Skip the designer and write the agent JSON yourself"
            >
              Advanced…
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-[var(--gt-border)] px-3 py-1 text-[11px] text-zinc-300 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!text.trim() || busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {busy ? (
                <Bot size={12} strokeWidth={2.5} />
              ) : (
                <EngineLogo engine={engine} size={12} />
              )}
              {busy
                ? 'Spawning…'
                : launchMode === 'terminal'
                  ? 'Open instance'
                  : `Design with ${engineLabel(engine)}`}
            </button>
          </div>
        </div>

        {err && <div className="text-[11px] text-[var(--gt-red)]">{err}</div>}
        <div className="text-[10.5px] text-zinc-600">
          ⌘↵ to submit · the designer reads CLAUDE.md,{' '}
          <span className="font-mono">.agents/forge.md</span>, and existing agent specs before
          writing your agent's prompt so it follows this project's MR + ticket conventions
          (worktree, auto-mergeable label, sole-writer scope, depends_on).
        </div>
      </DialogContent>
    </Dialog>
  )
}
