import { useReducer } from 'react'
import { EngineModelPicker } from '../../components/EngineModelPicker'
import { SkillHint } from '../../components/SkillHint'
import { Dialog, DialogContent } from '../../components/ui/dialog'
import type { Agent, AgentModelPolicy, AgentQuality, Engine } from '../../lib/types'
import { FIELD } from './agentsShared'

// The metadata sidecar editor: everything an agent's JSON entry carries, with
// the two structured blocks (model policy, quality contract) edited as raw
// JSON. Saving writes .agents/agents.json — overriding a built-in default
// keeps the same id, which is why the id is immutable once set.

type Form = {
  id: string
  title: string
  description: string
  engine: Engine
  model: string
  effort: string
  opensPr: boolean
  prompt: string
  outputContract: string
  modelPolicyJson: string
  qualityJson: string
  busy: boolean
  err: string
}

function initialForm(a: Agent | null): Form {
  return {
    id: a?.id || '',
    title: a?.title || '',
    description: a?.description || '',
    engine: a?.engine || 'codex',
    model: a?.model || '',
    effort: a?.effort || '',
    opensPr: !!a?.opensPr,
    prompt: a?.prompt || '',
    outputContract: a?.outputContract || '',
    modelPolicyJson: JSON.stringify(
      a?.modelPolicy || {
        default: a?.model || '',
        cheap: '',
        deep: '',
        judge: '',
        allowOverride: true,
      },
      null,
      2,
    ),
    qualityJson: JSON.stringify(
      a?.quality || {
        acceptanceCriteria: a?.acceptanceCriteria || [],
        requiredArtifacts: [],
        deterministicChecks: [],
        judge: {
          enabled: false,
          mode: 'deterministic',
          rubric: [],
        },
      },
      null,
      2,
    ),
    busy: false,
    err: '',
  }
}

function reduce(state: Form, patch: Partial<Form>): Form {
  return { ...state, ...patch }
}

export function AgentEditor({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent | 'new'
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = agent === 'new'
  const a = isNew ? null : (agent as Agent)
  const [form, set] = useReducer(reduce, a, initialForm)
  const {
    id,
    title,
    description,
    engine,
    model,
    effort,
    opensPr,
    prompt,
    outputContract,
    modelPolicyJson,
    qualityJson,
    busy,
    err,
  } = form

  const save = async () => {
    let modelPolicy: AgentModelPolicy | undefined
    let quality: AgentQuality | undefined
    try {
      modelPolicy = modelPolicyJson.trim()
        ? (JSON.parse(modelPolicyJson) as AgentModelPolicy)
        : undefined
      quality = qualityJson.trim() ? (JSON.parse(qualityJson) as AgentQuality) : undefined
    } catch (e) {
      set({ err: (e as Error).message })
      return
    }
    set({ busy: true, err: '' })
    const r = await window.gt.agents.save({
      id: id.trim(),
      title: title.trim(),
      description: description.trim(),
      engine,
      model: model.trim() || undefined,
      effort: effort.trim() || undefined,
      modelPolicy,
      quality,
      outputContract: outputContract.trim() || undefined,
      opensPr,
      prompt,
    })
    set({ busy: false })
    if (r && 'error' in r) set({ err: r.error })
    else onSaved()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[86vh] w-[640px] flex-col gap-3 overflow-y-auto rounded-2xl bg-[var(--gt-panel)] p-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-100">
            {isNew ? 'New agent' : `Edit · ${a?.title}`}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
        {isNew && (
          <SkillHint>
            You can also create one from the terminal with{' '}
            <code className="font-mono text-zinc-300">/new-agent "Create me an agent that …"</code>{' '}
            or{' '}
            <code className="font-mono text-zinc-300">$new-agent "Create me an agent that …"</code>.
          </SkillHint>
        )}
        {!isNew && a?.source !== 'repo' && (
          <p className="text-[11px] text-[var(--gt-yellow)]">
            Editing a built-in default — saving writes an override to{' '}
            <span className="font-mono">.agents/agents.json</span>; “Reset” reverts to the default.
          </p>
        )}
        <input
          value={id}
          onChange={(e) => set({ id: e.target.value })}
          disabled={!isNew}
          placeholder="id (kebab-case, e.g. triage-issues)"
          className={`${FIELD} font-mono ${isNew ? '' : 'opacity-50'}`}
        />
        <input
          value={title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Title"
          className={FIELD}
        />
        <input
          value={description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Short description (optional)"
          className={FIELD}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            engine + model
            <EngineModelPicker
              engine={engine}
              model={model || undefined}
              effort={effort || undefined}
              onEffortChange={(l) => set({ effort: l || '' })}
              onChange={(e, m) => set({ engine: e, model: m || '' })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-zinc-300">
            <input
              type="checkbox"
              checked={opensPr}
              onChange={(e) => set({ opensPr: e.target.checked })}
            />
            opens a PR
          </label>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          rows={12}
          placeholder="The full prompt the agent runs (what it should do, what to file/open, how to finish)…"
          className={`${FIELD} resize-y font-mono leading-relaxed`}
        />
        <textarea
          value={outputContract}
          onChange={(e) => set({ outputContract: e.target.value })}
          rows={2}
          placeholder="Output contract: what this agent should leave behind on a successful run"
          className={`${FIELD} resize-none leading-relaxed`}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">
              Model policy JSON
            </span>
            <textarea
              value={modelPolicyJson}
              onChange={(e) => set({ modelPolicyJson: e.target.value })}
              rows={8}
              className={`${FIELD} resize-y font-mono leading-relaxed`}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">
              Quality JSON
            </span>
            <textarea
              value={qualityJson}
              onChange={(e) => set({ qualityJson: e.target.value })}
              rows={8}
              className={`${FIELD} resize-y font-mono leading-relaxed`}
            />
          </label>
        </div>
        {err && <p className="text-[11px] text-[var(--gt-red)]">{err}</p>}
        <button
          onClick={save}
          disabled={busy || !id.trim() || !title.trim() || !prompt.trim()}
          className="self-start rounded-lg bg-[var(--gt-accent)] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save agent'}
        </button>
      </DialogContent>
    </Dialog>
  )
}
