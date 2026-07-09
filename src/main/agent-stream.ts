import type { Engine } from './agents'

type JsonRecord = Record<string, unknown>

type Decoder = {
  write(chunk: string): string
  end(): string
}

const isRecord = (v: unknown): v is JsonRecord => !!v && typeof v === 'object' && !Array.isArray(v)

function usageSummary(obj: JsonRecord): string {
  const cost = typeof obj.total_cost_usd === 'number' ? ` · $${obj.total_cost_usd.toFixed(4)}` : ''
  const duration = typeof obj.duration_ms === 'number' ? ` · ${(obj.duration_ms / 1000).toFixed(1)}s` : ''
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
  if (!decodeJson || (engine !== 'claude' && engine !== 'cursor')) {
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
          out += isRecord(parsed) ? textFromEvent(parsed) : ''
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
        return isRecord(parsed) ? textFromEvent(parsed) : ''
      } catch {
        return tail
      }
    },
  }
}
