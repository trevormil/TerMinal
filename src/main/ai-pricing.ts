// Per-model pricing table. Updated by hand when prices change. Pure data —
// no network, no SaaS. All rates are USD per *single token* (the standard
// "$X/M tokens" advertised rate divided by 1e6).
//
// Sources:
// - Anthropic: anthropic.com/pricing  (claude family)
// - OpenAI:   openai.com/api/pricing  (gpt-5/codex family)
//
// When the published rate is given per million, we normalize:
//   input  = listed / 1e6
//   output = listed / 1e6
// Cache pricing (Anthropic):
//   cacheRead  = ~0.1 × input
//   cacheWrite = ~1.25 × input  (one-time at creation)

export type ModelPrice = {
  /** USD per input token */
  input: number
  /** USD per output token */
  output: number
  /** USD per cache-hit input token (Anthropic). Optional — defaults to input. */
  cacheRead?: number
  /** USD per cache-write input token (Anthropic). Optional — defaults to input. */
  cacheWrite?: number
  /** Effective context window in tokens — used for headroom estimation. */
  contextWindow: number
  /** Human-friendly group for the cost-by-model chart. */
  family: 'claude' | 'codex' | 'openrouter' | 'unknown'
}

const M = 1_000_000

// Note: these are best-effort current rates as of mid-2026. The function
// `lookupPrice` does prefix matching so "claude-opus-4-7-20250920" maps to
// the same row as "claude-opus-4-7". When a model isn't found, we return a
// zero-cost row + log so we know to update the table.
const TABLE: Record<string, ModelPrice> = {
  // --- Claude family (Anthropic) ---
  'claude-haiku-4-5': {
    input: 1 / M,
    output: 5 / M,
    cacheRead: 0.1 / M,
    cacheWrite: 1.25 / M,
    contextWindow: 200_000,
    family: 'claude',
  },
  'claude-sonnet-4-6': {
    input: 3 / M,
    output: 15 / M,
    cacheRead: 0.3 / M,
    cacheWrite: 3.75 / M,
    contextWindow: 1_000_000,
    family: 'claude',
  },
  'claude-opus-4-7': {
    input: 15 / M,
    output: 75 / M,
    cacheRead: 1.5 / M,
    cacheWrite: 18.75 / M,
    contextWindow: 1_000_000,
    family: 'claude',
  },
  'claude-opus-4-8': {
    input: 15 / M,
    output: 75 / M,
    cacheRead: 1.5 / M,
    cacheWrite: 18.75 / M,
    contextWindow: 1_000_000,
    family: 'claude',
  },
  'claude-sonnet-5': {
    input: 2 / M,
    output: 10 / M,
    cacheRead: 0.2 / M,
    cacheWrite: 2.5 / M,
    contextWindow: 1_000_000,
    family: 'claude',
  },
  // --- Aliases for friendly names that show up in `--model haiku` etc. ---
  haiku: {
    input: 1 / M,
    output: 5 / M,
    cacheRead: 0.1 / M,
    cacheWrite: 1.25 / M,
    contextWindow: 200_000,
    family: 'claude',
  },
  sonnet: {
    input: 3 / M,
    output: 15 / M,
    cacheRead: 0.3 / M,
    cacheWrite: 3.75 / M,
    contextWindow: 1_000_000,
    family: 'claude',
  },
  opus: {
    input: 15 / M,
    output: 75 / M,
    cacheRead: 1.5 / M,
    cacheWrite: 18.75 / M,
    contextWindow: 1_000_000,
    family: 'claude',
  },
  // --- Codex / GPT family (OpenAI) ---
  'gpt-5': {
    input: 1.25 / M,
    output: 10 / M,
    contextWindow: 400_000,
    family: 'codex',
  },
  'gpt-5-codex': {
    input: 1.25 / M,
    output: 10 / M,
    contextWindow: 400_000,
    family: 'codex',
  },
  'gpt-5-mini': {
    input: 0.25 / M,
    output: 2 / M,
    contextWindow: 400_000,
    family: 'codex',
  },
  'o4-mini': {
    input: 0.6 / M,
    output: 2.4 / M,
    contextWindow: 200_000,
    family: 'codex',
  },
  'gpt-5.1-codex-mini': {
    input: 0.25 / M,
    output: 2 / M,
    cacheRead: 0.025 / M,
    contextWindow: 400_000,
    family: 'codex',
  },
  'gpt-5.6-terra': {
    input: 2.5 / M,
    output: 15 / M,
    cacheRead: 0.25 / M,
    contextWindow: 1_050_000,
    family: 'codex',
  },
  // --- OpenRouter catalog (the engines.ts openrouter/hermes lists). Runs
  // record provider/model slugs; lookupPrice strips the provider prefix
  // before matching. Rates verified against openrouter.ai/api/v1/models
  // on 2026-07-16. ---
  'deepseek-v4-flash': {
    input: 0.098 / M,
    output: 0.196 / M,
    cacheRead: 0.0196 / M,
    contextWindow: 1_048_576,
    family: 'openrouter',
  },
  'deepseek-v4-pro': {
    input: 0.435 / M,
    output: 0.87 / M,
    contextWindow: 1_048_576,
    family: 'openrouter',
  },
  'qwen3-coder-next': {
    input: 0.11 / M,
    output: 0.8 / M,
    cacheRead: 0.07 / M,
    contextWindow: 262_144,
    family: 'openrouter',
  },
  'glm-4.7-flash': {
    input: 0.06 / M,
    output: 0.4 / M,
    cacheRead: 0.01 / M,
    contextWindow: 202_752,
    family: 'openrouter',
  },
  'minimax-m3': {
    input: 0.3 / M,
    output: 1.2 / M,
    cacheRead: 0.06 / M,
    contextWindow: 1_048_576,
    family: 'openrouter',
  },
  'kimi-k2.7-code': {
    input: 0.75 / M,
    output: 3.5 / M,
    cacheRead: 0.16 / M,
    contextWindow: 262_144,
    family: 'openrouter',
  },
  'kimi-k3': {
    input: 3 / M,
    output: 15 / M,
    cacheRead: 0.3 / M,
    contextWindow: 1_048_576,
    family: 'openrouter',
  },
  'devstral-2512': {
    input: 0.4 / M,
    output: 2 / M,
    cacheRead: 0.04 / M,
    contextWindow: 262_144,
    family: 'openrouter',
  },
  'gemini-3.1-flash-lite': {
    input: 0.25 / M,
    output: 1.5 / M,
    cacheRead: 0.025 / M,
    contextWindow: 1_048_576,
    family: 'openrouter',
  },
  'glm-5.2': {
    input: 1.218 / M,
    output: 3.828 / M,
    cacheRead: 0.2262 / M,
    contextWindow: 1_048_576,
    family: 'openrouter',
  },
}

const ZERO: ModelPrice = { input: 0, output: 0, contextWindow: 0, family: 'unknown' }

/** Look up a price row. Tries exact match first, then prefix match against
 *  the full set so 'claude-opus-4-7-20250920' resolves to 'claude-opus-4-7'.
 *  Unknown models return a zero-cost row (so we track tokens but skip cost). */
export function lookupPrice(model: string): ModelPrice {
  if (!model) return ZERO
  const norm = model.toLowerCase().trim()
  const direct = lookupNormalized(norm)
  if (direct) return direct
  // OpenRouter-style provider/model slugs ("moonshotai/kimi-k3"): the table
  // keys bare model names, so retry with the provider prefix stripped.
  const slash = norm.indexOf('/')
  if (slash > 0) {
    const bare = lookupNormalized(norm.slice(slash + 1))
    if (bare) return bare
  }
  return ZERO
}

function lookupNormalized(norm: string): ModelPrice | null {
  if (TABLE[norm]) return TABLE[norm]
  // Prefix match — longest match wins
  let best: { key: string; price: ModelPrice } | null = null
  for (const [key, price] of Object.entries(TABLE)) {
    if (norm.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, price }
    }
  }
  return best?.price || null
}

/** Cost in USD for a run with the given token shape, given a model name. */
export function costOf(
  model: string,
  tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
): number {
  const p = lookupPrice(model)
  const inp = tokens.input || 0
  const out = tokens.output || 0
  const cr = tokens.cacheRead || 0
  const cw = tokens.cacheWrite || 0
  return (
    inp * p.input + out * p.output + cr * (p.cacheRead ?? p.input) + cw * (p.cacheWrite ?? p.input)
  )
}

export function knownModels(): string[] {
  return Object.keys(TABLE).sort()
}
