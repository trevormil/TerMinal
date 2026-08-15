import type { SavedPrompt } from './types'

// Spawn options for the New session screen: how MANY sessions one pick starts,
// and which prompt is prefilled into each of them.
//
// The prompt is PREFILLED, never submitted — it lands in the session's input
// exactly as if it had been typed, and the human presses Enter. That is why
// resolvePromptText strips trailing whitespace: a trailing newline would run it.

/** Spend guard. Eight sessions of a frontier model at once is already a lot. */
export const SPAWN_COUNT_MAX = 8

export const NO_PROMPT = 'none'
export const BUILTIN_PROMPT_ID = 'builtin:terminal-agent'

/**
 * The picker's only state: ×1, no prompt. Nothing is remembered across visits
 * or across spawns — this is also what the picker resets to right after each
 * spawn action, so a second spawn in the same visit is just as explicit as the
 * first.
 */
export const DEFAULT_SPAWN: { count: number; promptId: string; text: string } = {
  count: 1,
  promptId: NO_PROMPT,
  text: '',
}

/**
 * The built-in "TerMinal agent" briefing. Engine-agnostic on purpose: it is
 * prefilled into whichever CLI the session runs, so it names no vendor and
 * assumes no vendor-specific command beyond TerMinal's own `terminal-cli`.
 */
export const TERMINAL_AGENT_PROMPT = `You are an agent working inside TerMinal, the terminal app hosting this session.
TerMinal wraps agent CLIs in a software factory: tickets, agents, schedules, runs,
and an Inbox that collects anything a human still has to decide.
Before improvising, list what you already have: skills and slash commands cover
most recurring work here, so check them (\`/help\`, or your CLI's skills listing)
before writing a workflow by hand.
Read this repository's own instructions first — CLAUDE.md / AGENTS.md and docs/ —
and follow them over your general habits when the two disagree.
Work on a feature branch and finish with a PR. Never commit or push to main; the
merge is a human action, so stop once the PR is open and review-ready.
Keep changes surgical, test what you change, and say what you assumed rather than
guessing silently.
When you need a decision, a credential, or an approval, file an Inbox item with
\`terminal-cli inbox-item "<title>" "<what the human should do>"\` instead of
stalling or inventing an answer.
Finish with a short report: what changed, what you verified, what is left.`

/** One selectable prompt. `group` is '' for the two ungrouped defaults. */
export type PromptOption = {
  id: string
  label: string
  group: '' | 'Agents' | 'Custom'
  text: string
}

/** The agent shape this module needs — an id, a name, and a prompt body. */
export type PromptAgent = { id: string; title: string; prompt?: string }

/** Clamp anything (a stale pref, a hand-edited value) to a spawnable count. */
export function clampSpawnCount(raw: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, SPAWN_COUNT_MAX)
}

/**
 * The selector's options in display order: None, the built-in briefing, then
 * every agent that carries a prompt body, then the user's saved prompts.
 */
export function buildPromptOptions(input: {
  agents?: PromptAgent[]
  custom?: SavedPrompt[]
}): PromptOption[] {
  const options: PromptOption[] = [
    { id: NO_PROMPT, label: 'None', group: '', text: '' },
    { id: BUILTIN_PROMPT_ID, label: 'TerMinal agent', group: '', text: TERMINAL_AGENT_PROMPT },
  ]
  for (const a of input.agents ?? []) {
    // An agent whose work lives in a script has no prompt body to prefill.
    if (!a.prompt?.trim()) continue
    options.push({
      id: `agent:${a.id}`,
      label: a.title || a.id,
      group: 'Agents',
      text: a.prompt,
    })
  }
  for (const p of input.custom ?? []) {
    if (!p.text?.trim()) continue
    options.push({ id: `custom:${p.id}`, label: p.name || p.id, group: 'Custom', text: p.text })
  }
  return options
}

export function findPromptOption(options: PromptOption[], id: string): PromptOption | undefined {
  return options.find((o) => o.id === id)
}

/**
 * The text to prefill for a selection. An id that no longer resolves — a
 * deleted custom prompt, an agent that left the repo — degrades to no prompt
 * rather than to a stale body.
 */
export function resolvePromptText(options: PromptOption[], id: string): string {
  return (findPromptOption(options, id)?.text ?? '').replace(/\s+$/, '')
}

/**
 * The one-line summary the collapsed disclosure shows. Empty when nothing is
 * off default — a row that says "×1 · None" is chrome with no information.
 */
export function spawnSummary(count: number, promptId: string, options: PromptOption[]): string {
  const n = clampSpawnCount(count)
  const label = findPromptOption(options, promptId)?.text
    ? findPromptOption(options, promptId)!.label
    : ''
  return [n > 1 ? `×${n}` : '', label].filter(Boolean).join(' · ')
}
