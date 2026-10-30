// The self-hosted (openai-compat) engine's model catalog, read from the server.
//
// A self-hosted endpoint serves whatever the operator pulled/loaded (Ollama,
// vLLM, LM Studio, …), so there is no static list to ship. Every
// OpenAI-compatible server answers `GET {base}/models` with
// `{ data: [{ id }] }`, so the picker can offer the real slugs instead of a
// free-text field — a mistyped slug (`qwen3-v1` vs `qwen3-vl`) was the
// failure mode that motivated this.

export type OpenAICompatModel = { id: string; label: string }

/** Parse an OpenAI-style `/models` body. Pure; [] for anything malformed. */
export function parseOpenAICompatModels(body: unknown): OpenAICompatModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: OpenAICompatModel[] = []
  const seen = new Set<string>()
  for (const entry of data) {
    const id = (entry as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: id })
  }
  return out
}

/**
 * The models the configured endpoint serves. Returns [] when no base URL is
 * set, the server is down/slow, or the reply isn't a model list — the picker
 * then keeps its free-text field, i.e. today's behaviour. Not cached: a local
 * server's list changes the moment the operator pulls a model, and pickers
 * only ask when opened.
 */
export async function listOpenAICompatModels(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenAICompatModel[]> {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return []
  try {
    const res = await fetchImpl(`${base}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return []
    return parseOpenAICompatModels(await res.json())
  } catch {
    return []
  }
}
