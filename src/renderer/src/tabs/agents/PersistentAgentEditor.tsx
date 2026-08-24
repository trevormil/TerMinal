import { useEffect, useReducer } from 'react'
import { EngineModelPicker } from '../../components/EngineModelPicker'
import { SkillHint } from '../../components/SkillHint'
import { Dialog, DialogContent } from '../../components/ui/dialog'
import { navigateTo } from '../../lib/nav'
import { engineLabel } from '../../lib/engines'
import { engineInstanceLabel, openPromptInTerminal, remoteForTabContext } from '../../lib/launch'
import type { LaunchMode } from '../../lib/launch'
import type { Engine, TabContext } from '../../lib/types'
import { FIELD } from './agentsShared'

// "New persistent agent" — two ways in. AI mode describes the agent and lets
// an engine scaffold the whole memory directory; custom mode writes the
// minimal agent.json directly. Errors surface through the panel's shared error
// slot, so a failed create is visible after the modal closes too.

type Form = {
  mode: 'ai' | 'custom'
  request: string
  title: string
  description: string
  engine: Engine
  model: string | undefined
  launchMode: LaunchMode
  busy: boolean
  msg: string
}

const INITIAL: Form = {
  mode: 'ai',
  request: '',
  title: '',
  description: '',
  engine: 'codex',
  model: undefined,
  launchMode: 'terminal',
  busy: false,
  msg: '',
}

function reduce(state: Form, patch: Partial<Form>): Form {
  return { ...state, ...patch }
}

const DESIGN_PROMPT = (
  text: string,
) => `Create a new global persistent TerMinal memory agent from this request:

${text}

Target root:
~/.config/TerMinal/persistent-agents

Create exactly one new directory there with:
- agent.json
- INSTRUCTIONS.md
- MEMORY.md
- STATE.md
- JOURNAL.md
- artifacts/

Use the persistent agent schema TerMinal expects. Keep the files concise. Do not open a PR. Do not modify this repo unless explicitly needed. End with the created agent id and absolute directory path.`

export function PersistentAgentEditor({
  ctx,
  err,
  onErr,
  onClose,
  onCreated,
}: {
  ctx: TabContext
  err: string
  onErr: (message: string) => void
  onClose: () => void
  onCreated: (id: string) => void | Promise<void>
}) {
  const [form, set] = useReducer(reduce, INITIAL)
  const { mode, request, title, description, engine, model, launchMode, busy, msg } = form

  useEffect(() => {
    window.gt.settings
      .get()
      .then((s) => set({ engine: s.defaultEngine }))
      .catch(() => {})
  }, [])

  const create = async () => {
    const name = title.trim()
    if (!name) return
    onErr('')
    const r = await window.gt.persistentAgents.save({
      title: name,
      description,
      engine,
      model,
    })
    if ('error' in r) {
      onErr(r.error)
      return
    }
    await onCreated(r.id)
  }

  const design = async () => {
    const text = request.trim()
    if (!text || busy) return
    set({ busy: true, msg: '' })
    onErr('')
    try {
      if (launchMode === 'terminal') {
        openPromptInTerminal({
          engine,
          cwd: ctx.repoRoot,
          name: 'Design persistent agent',
          prompt: DESIGN_PROMPT(text),
          remote: remoteForTabContext(ctx),
        })
        onClose()
        return
      }
      const r = await window.gt.persistentAgents.design(text, engine, model)
      if ('error' in r) {
        onErr(r.error)
        return
      }
      set({ msg: `${engineLabel(engine)} is creating the persistent agent` })
      onClose()
      navigateTo('runs', { runId: r.id })
    } finally {
      set({ busy: false })
    }
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
        className="w-[640px] rounded-xl bg-[var(--gt-panel)] p-5"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-sm font-bold text-zinc-100">New persistent agent</h2>
          <div className="ml-auto flex items-center rounded-lg border border-[var(--gt-border)] bg-black/20 p-0.5">
            {(['ai', 'custom'] as const).map((m) => (
              <button
                key={m}
                onClick={() => set({ mode: m })}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium uppercase ${
                  mode === m
                    ? 'bg-[var(--gt-accent)]/20 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {mode === 'ai' ? (
            <>
              <SkillHint>
                You can also create one from a terminal with{' '}
                <code className="font-mono text-zinc-300">
                  /new-persistent-agent "Create a memory agent that …"
                </code>{' '}
                or{' '}
                <code className="font-mono text-zinc-300">
                  $new-persistent-agent "Create a memory agent that …"
                </code>
                .
              </SkillHint>
              <textarea
                value={request}
                onChange={(e) => set({ request: e.target.value })}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') design()
                }}
                rows={6}
                autoFocus
                placeholder="Describe the persistent agent: what it should remember, what it should do over time, and what good state/memory should look like."
                className={`${FIELD} resize-none`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <EngineModelPicker
                  engine={engine}
                  model={model}
                  onChange={(e, m) => set({ engine: e, model: m })}
                  size="sm"
                />
                <select
                  value={launchMode}
                  onChange={(e) => set({ launchMode: e.target.value as LaunchMode })}
                  className="rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-[var(--gt-accent)]/60"
                >
                  <option value="terminal">{engineInstanceLabel(engine)} instance</option>
                  <option value="process">Process</option>
                </select>
                {msg && <span className="text-[11px] text-[var(--gt-green)]">{msg}</span>}
              </div>
            </>
          ) : (
            <>
              <input
                value={title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="Agent name"
                autoFocus
                className={FIELD}
              />
              <textarea
                value={description}
                onChange={(e) => set({ description: e.target.value })}
                rows={4}
                placeholder="What should this agent remember and improve over time?"
                className={`${FIELD} resize-none`}
              />
              <EngineModelPicker
                engine={engine}
                model={model}
                onChange={(e, m) => set({ engine: e, model: m })}
                size="sm"
              />
            </>
          )}
          {err && <div className="text-[11px] text-[var(--gt-red)]">{err}</div>}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-[var(--gt-border)] px-3 py-1.5 text-[12px] text-zinc-300 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={mode === 'ai' ? design : create}
              disabled={mode === 'ai' ? !request.trim() || busy : !title.trim()}
              className="rounded-md bg-[var(--gt-accent)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {mode === 'ai'
                ? busy
                  ? 'Spawning...'
                  : launchMode === 'terminal'
                    ? 'Open instance'
                    : 'Create with AI'
                : 'Create'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
