// Shared helpers for the cheap-model tier — registry, spend log, budget math.
// Consumed by the sibling or-exec / or-agent / or-spend scripts.
//
// Dual-location: if a global ~/.claude/model-routing registry exists (a user
// who also runs the standalone `outsource` skill), use it so spend stays
// unified. Otherwise fall back to TerMinal's own ~/.config/TerMinal copy, which
// the app seeds on launch. Either way the scripts import THIS file relatively.
import { existsSync } from 'node:fs'

const HOME = process.env.HOME!
const CLAUDE_MR = `${HOME}/.claude/model-routing`
const TERMINAL_MR = `${HOME}/.config/TerMinal/model-routing`
const BASE = existsSync(`${CLAUDE_MR}/models.json`) ? CLAUDE_MR : TERMINAL_MR

export const REGISTRY = `${BASE}/models.json`
export const SPEND = `${BASE}/spend.jsonl`

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** Resolve the OpenAI-compatible endpoint for or-exec / or-agent.
 *  OPENAI_BASE_URL unset/blank → OpenRouter, keyed by OPENROUTER_API_KEY,
 *  byte-for-byte today's behavior. Set → that endpoint (self-hosted vLLM /
 *  Ollama / LM Studio / TGI / llama.cpp — anything speaking /v1/chat/completions),
 *  keyed by OPENAI_API_KEY with OPENROUTER_API_KEY as fallback. Keyless local
 *  servers: set OPENAI_API_KEY to any placeholder (e.g. "none") — they ignore
 *  the Authorization header. */
export function resolveEndpoint(env: Record<string, string | undefined>): {
  baseUrl: string
  custom: boolean
  key: string
} {
  const raw = (env.OPENAI_BASE_URL ?? '').trim()
  const custom = !!raw
  const baseUrl = (custom ? raw : OPENROUTER_BASE_URL).replace(/\/+$/, '')
  const key = custom
    ? env.OPENAI_API_KEY || env.OPENROUTER_API_KEY || ''
    : env.OPENROUTER_API_KEY || ''
  return { baseUrl, custom, key }
}

export async function loadRegistry(): Promise<any> {
  return JSON.parse(await Bun.file(REGISTRY).text())
}

export async function readSpend(): Promise<any[]> {
  try {
    return (await Bun.file(SPEND).text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

export async function logSpend(entry: Record<string, unknown>): Promise<void> {
  const prev = await Bun.file(SPEND)
    .text()
    .catch(() => '')
  await Bun.write(SPEND, prev + JSON.stringify(entry) + '\n')
}

export const todayISO = () => new Date().toISOString().slice(0, 10)

export function summarize(entries: any[], opts: { today?: string; session?: string | null } = {}) {
  const today = opts.today ?? todayISO()
  let spentToday = 0,
    spentSession = 0
  for (const r of entries) {
    if ((r.ts ?? '').startsWith(today)) spentToday += r.cost ?? 0
    if (opts.session && r.session === opts.session) spentSession += r.cost ?? 0
  }
  return { spentToday, spentSession }
}

// Returns a human message if a cap is hit, else null. Exhaustion is a signal to
// the caller to use its own model — never a crash.
export function budgetBlock(
  reg: any,
  sums: { spentToday: number; spentSession: number },
  session: string | null,
): string | null {
  const dailyPool = Number(reg.budget?.dailyPoolUSD ?? Infinity)
  const sessionCap = Number(reg.budget?.perSessionCapUSD ?? Infinity)
  if (sums.spentToday >= dailyPool)
    return `daily OpenRouter budget exhausted ($${sums.spentToday.toFixed(4)} >= $${dailyPool}). Use your own model, or raise budget.dailyPoolUSD.`
  if (session && sums.spentSession >= sessionCap)
    return `session '${session}' budget exhausted ($${sums.spentSession.toFixed(4)} >= $${sessionCap}). Use your own model, or raise budget.perSessionCapUSD.`
  return null
}
