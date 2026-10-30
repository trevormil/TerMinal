import { describe, expect, it } from 'bun:test'
import { listOpenAICompatModels, parseOpenAICompatModels } from './openai-compat-models'

// Real body from Ollama's OpenAI-compatible endpoint (GET /v1/models).
const OLLAMA = {
  object: 'list',
  data: [{ id: 'qwen3-vl:8b', object: 'model', created: 1793314244, owned_by: 'library' }],
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('parseOpenAICompatModels', () => {
  it('maps data[].id to picker options', () => {
    expect(parseOpenAICompatModels(OLLAMA)).toEqual([{ id: 'qwen3-vl:8b', label: 'qwen3-vl:8b' }])
  })

  it('is empty for junk, so the picker keeps its free-text field', () => {
    expect(parseOpenAICompatModels(null)).toEqual([])
    expect(parseOpenAICompatModels({})).toEqual([])
    expect(parseOpenAICompatModels({ data: 'nope' })).toEqual([])
    expect(parseOpenAICompatModels({ data: [{ id: 3 }, { id: '' }, null] })).toEqual([])
  })

  it('dedupes repeated ids', () => {
    expect(parseOpenAICompatModels({ data: [{ id: 'a' }, { id: 'a' }] })).toHaveLength(1)
  })
})

describe('listOpenAICompatModels', () => {
  it('GETs {base}/models, tolerating a trailing slash, and sends the key', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse(OLLAMA)
    }) as unknown as typeof fetch
    const models = await listOpenAICompatModels('http://localhost:11434/v1/', 'sk-x', fake)
    expect(models.map((m) => m.id)).toEqual(['qwen3-vl:8b'])
    expect(calls[0].url).toBe('http://localhost:11434/v1/models')
    expect(calls[0].init?.headers).toEqual({ Authorization: 'Bearer sk-x' })
  })

  it('sends no Authorization header for keyless servers', async () => {
    let headers: unknown
    const fake = (async (_url: string, init?: RequestInit) => {
      headers = init?.headers
      return jsonResponse(OLLAMA)
    }) as unknown as typeof fetch
    await listOpenAICompatModels('http://localhost:11434/v1', '', fake)
    expect(headers).toEqual({})
  })

  it('returns [] without a base URL, on HTTP errors, and on network failure', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return jsonResponse(OLLAMA)
    }) as unknown as typeof fetch
    expect(await listOpenAICompatModels('  ', '', spy)).toEqual([])
    expect(called).toBe(false)

    const unauthorized = (async () => jsonResponse({ error: 'no' }, 401)) as unknown as typeof fetch
    expect(await listOpenAICompatModels('http://x/v1', '', unauthorized)).toEqual([])

    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await listOpenAICompatModels('http://x/v1', '', down)).toEqual([])
  })
})
