import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Layers, Save, Trash2 } from 'lucide-react'
import type { AgentDefinition, SavedPrompt } from '../lib/types'
import {
  NO_PROMPT,
  SPAWN_COUNT_MAX,
  buildPromptOptions,
  clampSpawnCount,
  findPromptOption,
  spawnSummary,
  type PromptOption,
} from '../lib/spawnOptions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from './ui'

export type SpawnOptionsValue = {
  /** How many sessions one pick spawns. 1 = today's behavior exactly. */
  count: number
  /** The selected prompt's option id, or NO_PROMPT. */
  promptId: string
  /** The text actually prefilled — the selection's body, or an edited draft. */
  text: string
}

/**
 * The New session screen's spawn options: a multiplier and the prompt prefilled
 * into each session it starts. One collapsed row by default — the screen's job
 * is picking an engine and a workspace, and this must not compete with it.
 *
 * The prompt is typed into the session, never submitted. Everything about the
 * assembly (ordering, resolution, the summary line) is pure and lives in
 * lib/spawnOptions.ts; this file is the surface.
 */
export function SpawnOptions({
  value,
  onChange,
  savedPrompts,
  onSaveCustom,
  onDeleteCustom,
}: {
  value: SpawnOptionsValue
  onChange: (next: SpawnOptionsValue) => void
  savedPrompts: SavedPrompt[]
  onSaveCustom: (prompt: SavedPrompt) => void
  onDeleteCustom: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [agents, setAgents] = useState<AgentDefinition[]>([])
  const [saveName, setSaveName] = useState('')

  // Agent definitions carry the prompt bodies this screen offers under
  // "Agents"; a repo with none (or a failed read) still gets None + built-in.
  useEffect(() => {
    let live = true
    window.gt.agents
      .definitions()
      .then((defs) => live && setAgents(Array.isArray(defs) ? defs : []))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const options = useMemo(
    () =>
      buildPromptOptions({
        agents: agents.map((a) => ({ id: a.id, title: a.title, prompt: a.instructions?.prompt })),
        custom: savedPrompts,
      }),
    [agents, savedPrompts],
  )
  const selected = findPromptOption(options, value.promptId)
  const summary = spawnSummary(value.count, value.promptId, options)
  const edited = !!selected && value.text.trim() !== selected.text.trim()
  const isCustom = value.promptId.startsWith('custom:')

  // The selection is restored from a pref before the options exist, so the text
  // is filled in once they arrive. A selection whose option DISAPPEARED — a
  // deleted custom prompt, an agent that left the repo — falls back to None
  // rather than silently prefilling a body nothing names any more.
  useEffect(() => {
    if (value.promptId === NO_PROMPT) return
    if (!selected) onChange({ ...value, promptId: NO_PROMPT, text: '' })
    else if (!value.text) onChange({ ...value, text: selected.text })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  const pickPrompt = (id: string) => {
    onChange({ ...value, promptId: id, text: findPromptOption(options, id)?.text ?? '' })
    setSaveName('')
  }
  const saveCurrent = () => {
    const name = saveName.trim()
    const text = value.text.trim()
    if (!name || !text) return
    const id = `sp-${Date.now().toString(36)}`
    onSaveCustom({ id, name, text })
    onChange({ ...value, promptId: `custom:${id}`, text })
    setSaveName('')
  }
  const deleteCurrent = () => {
    if (!isCustom) return
    onDeleteCustom(value.promptId.slice('custom:'.length))
    onChange({ ...value, promptId: NO_PROMPT, text: '' })
  }

  const groups: { label: PromptOption['group']; items: PromptOption[] }[] = [
    { label: 'Agents', items: options.filter((o) => o.group === 'Agents') },
    { label: 'Custom', items: options.filter((o) => o.group === 'Custom') },
  ]

  return (
    <div data-spawn-options className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="spawn-options-body"
        className="flex w-full items-center gap-2.5 text-left"
      >
        {open ? (
          <ChevronDown size={13} strokeWidth={2} className="shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-zinc-500" />
        )}
        <Layers size={14} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-2)]" />
        <span className="text-[12px] font-semibold text-zinc-100">Spawn options</span>
        {summary ? (
          <span
            data-spawn-summary
            className="truncate rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-1.5 py-0.5 text-[10.5px] text-[var(--gt-accent-2)]"
          >
            {summary}
          </span>
        ) : (
          <span className="truncate text-[10.5px] text-zinc-600">
            One session, no prompt prefilled
          </span>
        )}
      </button>

      {open && (
        <div
          id="spawn-options-body"
          className="mt-3 space-y-3 border-t border-[var(--gt-border)] pt-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="spawn-count" className="text-[11px] text-zinc-400">
              Sessions
            </label>
            <Select
              id="spawn-count"
              data-spawn-count
              value={String(clampSpawnCount(value.count))}
              onChange={(e) => onChange({ ...value, count: clampSpawnCount(e.target.value) })}
              className="w-[86px]"
            >
              {Array.from({ length: SPAWN_COUNT_MAX }, (_, i) => i + 1).map((n) => (
                <option key={n} value={String(n)}>
                  ×{n}
                </option>
              ))}
            </Select>
            <label htmlFor="spawn-prompt" className="ml-2 text-[11px] text-zinc-400">
              Prompt
            </label>
            <Select
              id="spawn-prompt"
              data-spawn-prompt
              value={value.promptId}
              onChange={(e) => pickPrompt(e.target.value)}
              className="min-w-[200px] flex-1"
            >
              {options
                .filter((o) => o.group === '')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              {groups.map(
                (g) =>
                  g.items.length > 0 && (
                    <optgroup key={g.label} label={g.label}>
                      {g.items.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ),
              )}
            </Select>
          </div>

          {value.promptId !== NO_PROMPT && (
            <>
              <textarea
                aria-label="Prompt text"
                data-spawn-text
                value={value.text}
                onChange={(e) => onChange({ ...value, text: e.target.value })}
                rows={5}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-[var(--gt-border)] bg-black/30 px-3 py-2 text-[11.5px] leading-relaxed text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveCurrent()}
                  placeholder="Save current as…"
                  aria-label="Name for the saved prompt"
                  className="min-w-[180px] flex-1"
                />
                <Button
                  size="sm"
                  onClick={saveCurrent}
                  disabled={!saveName.trim() || !value.text.trim()}
                >
                  <Save size={11} strokeWidth={2} className="shrink-0" />
                  Save
                </Button>
                {isCustom && (
                  <Button
                    variant="destructive"
                    size="icon"
                    aria-label="Delete this saved prompt"
                    title="Delete this saved prompt"
                    onClick={deleteCurrent}
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </Button>
                )}
              </div>
            </>
          )}
          <div className="text-[10.5px] leading-snug text-zinc-600">
            The prompt is typed into each new session and left unsent — press Enter to run it.
            {edited && ' Edited — save it above to keep this version.'}
          </div>
        </div>
      )}
    </div>
  )
}
