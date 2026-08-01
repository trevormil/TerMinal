import type { Engine } from './agents'

type JsonRecord = Record<string, unknown>

type Decoder = {
  write(chunk: string): string
  end(): string
}

const isRecord = (v: unknown): v is JsonRecord => !!v && typeof v === 'object' && !Array.isArray(v)

function usageSummary(obj: JsonRecord): string {
  const cost = typeof obj.total_cost_usd === 'number' ? ` · $${obj.total_cost_usd.toFixed(4)}` : ''
  const duration =
    typeof obj.duration_ms === 'number' ? ` · ${(obj.duration_ms / 1000).toFixed(1)}s` : ''
  return cost || duration ? `\n[usage${cost}${duration}]\n` : ''
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (!isRecord(item)) return ''
      if (item.type === 'text' && typeof item.text === 'string') return item.text
      if (item.type === 'tool_use') {
        const name = typeof item.name === 'string' ? item.name : 'tool'
        return `\n[tool] ${name}\n`
      }
      return ''
    })
    .join('')
}

function textFromEvent(obj: JsonRecord): string {
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.delta === 'string') return obj.delta
  if (typeof obj.content === 'string') return obj.content

  if (isRecord(obj.delta) && typeof obj.delta.text === 'string') return obj.delta.text
  if (isRecord(obj.message)) return textFromContent(obj.message.content)

  const type = typeof obj.type === 'string' ? obj.type : ''
  if (type.includes('tool')) {
    const name = typeof obj.name === 'string' ? obj.name : 'tool'
    return `\n[tool] ${name}\n`
  }
  if (type === 'result') return usageSummary(obj)
  return ''
}

// ---- pi (`--mode json`) ----------------------------------------------------
//
// Pi's JSONL is close enough to Claude's to be tempting and different enough to
// be wrong: it emits message_start, message_update (deltas), message_end,
// turn_end AND agent_end all carrying the SAME message object. Running it
// through textFromEvent would print every assistant turn four times over.
//
// Shapes below are from `pi -p --mode json` output (0.83.0), not the docs — the
// docs omit the usage/cost object entirely and never mention --session-id.
//   {"type":"message_update","message":{…},"assistantMessageEvent":{"type":"text_delta","delta":"Hello"}}
//   {"type":"tool_execution_start","toolCallId":"…","toolName":"bash","args":{…}}
//   {"type":"message_end","message":{"role":"assistant","content":[…],
//     "usage":{"totalTokens":N,"cost":{"total":N}},"errorMessage":"…"}}
type PiState = { streamedThisMessage: boolean; costUsd: number; tokens: number }

function piEventText(obj: JsonRecord, state: PiState): string {
  const type = typeof obj.type === 'string' ? obj.type : ''

  if (type === 'message_update') {
    const ev = obj.assistantMessageEvent
    if (isRecord(ev) && ev.type === 'text_delta') {
      const delta = typeof ev.delta === 'string' ? ev.delta : ''
      if (delta) state.streamedThisMessage = true
      return delta
    }
    return ''
  }

  if (type === 'message_start') {
    state.streamedThisMessage = false
    return ''
  }

  if (type === 'tool_execution_start') {
    const name = typeof obj.toolName === 'string' ? obj.toolName : 'tool'
    return `\n[tool] ${name}\n`
  }

  if (type === 'message_end') {
    const msg = isRecord(obj.message) ? obj.message : null
    if (!msg || msg.role !== 'assistant') return ''
    // Accumulate here rather than at agent_end: agent_end replays every message,
    // so summing there would double-count anything already seen.
    const usage = isRecord(msg.usage) ? msg.usage : null
    if (usage) {
      if (typeof usage.totalTokens === 'number') state.tokens += usage.totalTokens
      const cost = isRecord(usage.cost) ? usage.cost : null
      if (cost && typeof cost.total === 'number') state.costUsd += cost.total
    }
    const err = typeof msg.errorMessage === 'string' ? msg.errorMessage : ''
    if (err) return `\n[error] ${err}\n`
    // A provider that did not stream deltas (or a cached/instant reply) leaves
    // the whole turn only on this event — without the fallback its text is lost.
    if (state.streamedThisMessage) return '\n'
    return textFromContent(msg.content)
  }

  if (type === 'agent_end') {
    const cost = state.costUsd > 0 ? ` · $${state.costUsd.toFixed(4)}` : ''
    const tokens = state.tokens > 0 ? ` · ${state.tokens} tok` : ''
    return cost || tokens ? `\n[usage${cost}${tokens}]\n` : ''
  }

  // session / agent_start / turn_start / turn_end / compaction / retries carry
  // no transcript text. Silence is correct; they are lifecycle, not content.
  return ''
}

// codex exec (used directly by the codex engine and under the hood by or-agent
// for OpenRouter) interleaves its human output with harness noise — hook status
// lines, a deprecation notice, an MCP auth error, and the stdin prompt. Drop
// those so the Runs/Agents log reads as the actual transcript.
const CODEX_NOISE = [
  /^hook: /,
  /^deprecated: /,
  /\bERROR rmcp::transport/,
  /^Reading additional input from stdin/,
]

export function createAgentStreamDecoder(engine: Engine, decodeJson: boolean): Decoder {
  const jsonEngines = ['claude', 'cursor', 'pi']
  if (!decodeJson || !jsonEngines.includes(engine)) {
    // Raw engines (codex / openrouter): line-buffer only to strip known noise;
    // everything else passes through verbatim.
    let raw = ''
    const flush = (text: string) => {
      raw += text
      const lines = raw.split(/\r?\n/)
      raw = lines.pop() || ''
      return lines
        .filter((l) => !CODEX_NOISE.some((re) => re.test(l)))
        .map((l) => `${l}\n`)
        .join('')
    }
    return {
      write: (chunk) => flush(chunk),
      end: () => {
        const tail = raw
        raw = ''
        return tail && !CODEX_NOISE.some((re) => re.test(tail)) ? tail : ''
      },
    }
  }

  let buffer = ''
  const piState: PiState = { streamedThisMessage: false, costUsd: 0, tokens: 0 }
  const decode = (obj: JsonRecord): string =>
    engine === 'pi' ? piEventText(obj, piState) : textFromEvent(obj)
  return {
    write(chunk: string) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      let out = ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as unknown
          out += isRecord(parsed) ? decode(parsed) : ''
        } catch {
          out += `${line}\n`
        }
      }
      return out
    },
    end() {
      const tail = buffer
      buffer = ''
      if (!tail.trim()) return ''
      try {
        const parsed = JSON.parse(tail) as unknown
        return isRecord(parsed) ? decode(parsed) : ''
      } catch {
        return tail
      }
    },
  }
}
