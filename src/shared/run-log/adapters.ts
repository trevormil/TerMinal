// Per-engine adapters: each turns the (sanitized) lines of one log segment into
// the shared RunLogEntry model. Mirrors createAgentStreamDecoder's engine
// special-casing (src/main/agent-stream.ts) one layer up: instead of flattening
// to display text, we lift the text into typed entries.

import type { RunLogEntry } from './types'

type JsonRecord = Record<string, unknown>
type ToolEntry = Extract<RunLogEntry, { kind: 'tool' }>
type CommandEntry = Extract<RunLogEntry, { kind: 'command' }>

export type RunLogAdapter = (lines: string[]) => RunLogEntry[]

const isRecord = (v: unknown): v is JsonRecord => !!v && typeof v === 'object' && !Array.isArray(v)

function trimBlankEdges(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start++
  while (end > start && !lines[end - 1].trim()) end--
  return lines.slice(start, end)
}

/** Append assistant text, merging into a trailing assistant entry. */
function pushAssistant(entries: RunLogEntry[], text: string, sep: string): void {
  if (!text) return
  const last = entries[entries.length - 1]
  if (last?.kind === 'assistant') last.text += sep + text
  else entries.push({ kind: 'assistant', text })
}

/** Append banner lines, merging into a trailing banner entry. */
function appendBanner(entries: RunLogEntry[], lines: string[]): void {
  const kept = lines.filter((l) => l.trim())
  if (!kept.length) return
  const last = entries[entries.length - 1]
  if (last?.kind === 'banner') last.lines.push(...kept)
  else entries.push({ kind: 'banner', lines: kept })
}

// ---- shared line markers (decoded stream + runner conventions) --------------

// `[tool] Name` / `[usage · $x · ys]` / `[spawn error] …` are what
// createAgentStreamDecoder and agents.ts themselves emit into stored output;
// `DONE:` / `FAILED:` are the runner's highlight conventions.
function markerEntry(t: string): RunLogEntry | null {
  const tool = t.match(/^\[tool\]\s*(.+)$/i)
  if (tool) return { kind: 'tool', name: tool[1].trim(), status: 'unknown' }
  const usage = t.match(/^\[usage(?: · \$([0-9.]+))?(?: · ([0-9.]+)s)?\]$/i)
  if (usage)
    return {
      kind: 'summary',
      text: t,
      costUsd: usage[1] ? Number(usage[1]) : undefined,
      durationMs: usage[2] ? Math.round(Number(usage[2]) * 1000) : undefined,
    }
  const spawn = t.match(/^\[spawn error\]\s*(.+)$/i)
  if (spawn) return { kind: 'error', text: spawn[1].trim() }
  const failed = t.match(/^FAILED:\s*(.+)$/i)
  if (failed) return { kind: 'error', text: failed[1].trim() }
  const done = t.match(/^DONE:\s*(.+)$/i)
  if (done) return { kind: 'summary', text: done[1].trim() }
  return null
}

// ---- generic adapter (scripts, unknown engines) -----------------------------

// No engine-specific transcript shape to rely on: pull out the shared markers,
// keep everything else as ordered blocks of `proseKind` entries.
function markerProseAdapter(proseKind: 'text' | 'assistant'): RunLogAdapter {
  return (lines) => {
    const entries: RunLogEntry[] = []
    let buf: string[] = []
    const flush = () => {
      const body = trimBlankEdges(buf)
      buf = []
      if (body.length) entries.push({ kind: proseKind, text: body.join('\n') })
    }
    for (const line of lines) {
      const m = markerEntry(line.trim())
      if (m) {
        flush()
        entries.push(m)
      } else buf.push(line)
    }
    flush()
    return entries
  }
}

export const genericAdapter: RunLogAdapter = markerProseAdapter('text')

// hermes -z prints the assistant's final markdown response (tool traffic and
// usage go elsewhere), so free prose IS the assistant message — unlike unknown
// engines where we can't assume that.
export const hermesAdapter: RunLogAdapter = markerProseAdapter('assistant')

// ---- claude / cursor adapter (stream-json + its decoded form) ---------------

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n')
}

function handleStreamEvent(
  obj: JsonRecord,
  rawLine: string,
  entries: RunLogEntry[],
  toolsById: Map<string, ToolEntry>,
): void {
  const type = typeof obj.type === 'string' ? obj.type : ''

  if (type === 'system') {
    const bits = [
      typeof obj.subtype === 'string' ? obj.subtype : 'system',
      typeof obj.model === 'string' ? obj.model : '',
    ].filter(Boolean)
    appendBanner(entries, [bits.join(' · ')])
    return
  }

  if ((type === 'assistant' || type === 'user') && isRecord(obj.message)) {
    const content = obj.message.content
    const items = Array.isArray(content)
      ? content
      : typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : []
    for (const item of items) {
      if (!isRecord(item)) continue
      if (item.type === 'text' && typeof item.text === 'string') {
        if (type === 'assistant') pushAssistant(entries, item.text, '\n')
        else entries.push({ kind: 'text', text: item.text })
      } else if (item.type === 'tool_use') {
        const entry: ToolEntry = {
          kind: 'tool',
          name: typeof item.name === 'string' ? item.name : 'tool',
          input:
            item.input === undefined
              ? undefined
              : typeof item.input === 'string'
                ? item.input
                : JSON.stringify(item.input, null, 2),
          status: 'unknown',
        }
        entries.push(entry)
        if (typeof item.id === 'string') toolsById.set(item.id, entry)
      } else if (item.type === 'tool_result') {
        const output = toolResultText(item.content)
        const target =
          (typeof item.tool_use_id === 'string' && toolsById.get(item.tool_use_id)) ||
          [...entries]
            .reverse()
            .find((e): e is ToolEntry => e.kind === 'tool' && e.output === undefined)
        if (target) {
          target.output = output
          target.status = item.is_error === true ? 'error' : 'ok'
        } else if (output) {
          entries.push({ kind: 'text', text: output })
        }
      }
    }
    return
  }

  if (type === 'result') {
    entries.push({
      kind: 'summary',
      text: typeof obj.result === 'string' ? obj.result : '',
      costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined,
      durationMs: typeof obj.duration_ms === 'number' ? obj.duration_ms : undefined,
    })
    return
  }

  // cursor-style text deltas ({type:"text", text}/{delta:...}) — append raw.
  if (typeof obj.text === 'string') return pushAssistant(entries, obj.text, '')
  if (typeof obj.delta === 'string') return pushAssistant(entries, obj.delta, '')
  if (isRecord(obj.delta) && typeof obj.delta.text === 'string')
    return pushAssistant(entries, obj.delta.text, '')

  // Known protocol chatter (has a type) is dropped, same as the live decoder;
  // unrecognized JSON without a type is kept verbatim so nothing is lost.
  if (!type) entries.push({ kind: 'text', text: rawLine })
}

export const claudeAdapter: RunLogAdapter = (lines) => {
  const entries: RunLogEntry[] = []
  const toolsById = new Map<string, ToolEntry>()
  let buf: string[] = []
  const flushProse = () => {
    const body = trimBlankEdges(buf)
    buf = []
    if (body.length) pushAssistant(entries, body.join('\n'), '\n')
  }
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('{')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(t)
      } catch {
        // truncated / non-JSON braces — keep as plain text, never drop
        flushProse()
        entries.push({ kind: 'text', text: line })
        continue
      }
      if (isRecord(parsed)) {
        flushProse()
        handleStreamEvent(parsed, line, entries, toolsById)
        continue
      }
    }
    const m = markerEntry(t)
    if (m) {
      flushProse()
      entries.push(m)
      continue
    }
    buf.push(line)
  }
  flushProse()
  return entries
}

// ---- codex exec adapter (codex + openrouter via or-agent) -------------------

// Section format (codex exec ≥0.13x, optionally `[timestamp] `-prefixed):
//   OpenAI Codex vX.Y.Z          banner, then a `--------`-delimited config block
//   user                          prompt section
//   thinking                      reasoning section
//   codex                         assistant message section
//   exec                          next line(s): `<command> in <cwd>`
//    succeeded in 12ms: / exited 1 in 3ms:   result block for the OLDEST
//                                 still-unresolved exec (results pair FIFO)
//   tokens used: N                usage summary
const CODEX_NOISE = [
  /^hook: /,
  /^deprecated: /,
  /\bERROR rmcp::transport/,
  /^Reading additional input from stdin/,
]
const SECTION = /^(?:\[[^\]]*\]\s*)?(user|codex|thinking|exec)$/
const RESULT_LINE = /^(?:\[[^\]]*\]\s*)?(?:succeeded|exited (-?\d+)) in ([0-9.]+)(ms|s):?$/
const TOKENS_LINE = /^(?:\[[^\]]*\]\s*)?tokens used:?\s*([\d,]+)\s*$/
// codex ≥0.14x prints the count on the following line: `tokens used\n23,812`
const TOKENS_BARE = /^(?:\[[^\]]*\]\s*)?tokens used:?\s*$/
const TOKENS_COUNT = /^([\d,]+)\s*$/
const BANNER_LINE = /^(?:\[[^\]]*\]\s*)?OpenAI Codex v/
const BANNER_DASHES = /^-{4,}$/
const CMD_CWD = /\s+in\s+(\/\S*)$/

export const codexAdapter: RunLogAdapter = (lines) => {
  const entries: RunLogEntry[] = []
  let mode: 'text' | 'prompt' | 'assistant' | 'reasoning' | 'output' = 'text'
  let outputTarget: CommandEntry | null = null
  let buf: string[] = []
  let banner: string[] | null = null
  let bannerDashes = 0

  const flush = () => {
    const body = trimBlankEdges(buf)
    buf = []
    if (mode === 'output') {
      if (outputTarget) outputTarget.output = body.join('\n')
      else if (body.length) entries.push({ kind: 'text', text: body.join('\n') })
      outputTarget = null
    } else if (body.length) {
      const text = body.join('\n')
      if (mode === 'prompt') entries.push({ kind: 'prompt', text })
      else if (mode === 'assistant') pushAssistant(entries, text, '\n')
      else if (mode === 'reasoning') entries.push({ kind: 'reasoning', text })
      else entries.push({ kind: 'text', text })
    }
    mode = 'text'
  }

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()

    if (banner) {
      if (banner.length === 1 && !BANNER_DASHES.test(t)) {
        // version line without a config block — close and reprocess this line
        appendBanner(entries, banner)
        banner = null
      } else {
        banner.push(t)
        if (BANNER_DASHES.test(t)) {
          bannerDashes++
          if (bannerDashes === 2) {
            appendBanner(entries, banner)
            banner = null
          }
        }
        continue
      }
    }

    if (!t && mode === 'text' && !buf.some((l) => l.trim())) continue
    if (CODEX_NOISE.some((re) => re.test(t))) continue

    if (/^or-agent: running\b/.test(t)) {
      flush()
      appendBanner(entries, [t])
      continue
    }
    if (/^or-agent: done\b/.test(t)) {
      flush()
      const m = t.match(/\$([0-9.]+)/)
      entries.push({ kind: 'summary', text: t, costUsd: m ? Number(m[1]) : undefined })
      continue
    }
    const orErr = t.match(/^or-agent:\s*(.+)$/)
    if (orErr) {
      // any other or-agent line is the wrapper reporting a failure
      flush()
      entries.push({ kind: 'error', text: orErr[1].trim() })
      continue
    }
    if (BANNER_LINE.test(t)) {
      flush()
      banner = [t]
      bannerDashes = 0
      continue
    }
    const tok = t.match(TOKENS_LINE)
    if (tok) {
      flush()
      entries.push({ kind: 'summary', text: t, tokens: Number(tok[1].replace(/,/g, '')) })
      continue
    }
    if (TOKENS_BARE.test(t)) {
      const next = (lines[i + 1] || '').trim().match(TOKENS_COUNT)
      if (next) {
        flush()
        entries.push({
          kind: 'summary',
          text: `tokens used: ${next[1]}`,
          tokens: Number(next[1].replace(/,/g, '')),
        })
        i++
        continue
      }
    }
    const res = t.match(RESULT_LINE)
    if (res) {
      flush()
      // Pair with the oldest unresolved command (FIFO). When codex batches
      // multiple execs their results print in COMPLETION order with no label,
      // so perfect pairing is impossible from the text; FIFO matches issue
      // order, which is correct for sequential runs and for same-duration
      // batches (the overwhelmingly common cases).
      const target =
        entries.find(
          (e): e is CommandEntry =>
            e.kind === 'command' && e.status === 'unknown' && e.output === undefined,
        ) || null
      if (target) {
        const exitCode = res[1] !== undefined ? Number(res[1]) : 0
        target.exitCode = exitCode
        target.status = exitCode === 0 ? 'ok' : 'error'
        target.durationMs = Math.round(Number(res[2]) * (res[3] === 's' ? 1000 : 1))
        outputTarget = target
        mode = 'output'
      } else {
        entries.push({ kind: 'text', text: t })
      }
      continue
    }
    const sec = t.match(SECTION)
    if (sec) {
      flush()
      const name = sec[1]
      if (name === 'user') mode = 'prompt'
      else if (name === 'codex') mode = 'assistant'
      else if (name === 'thinking') mode = 'reasoning'
      else {
        // exec — collect the command line(s), which end with ` in <cwd>`
        const cmdLines: string[] = []
        let cwd: string | undefined
        let j = i + 1
        for (; j < lines.length && cmdLines.length < 20; j++) {
          const ct = lines[j].trim()
          if (!ct || SECTION.test(ct) || RESULT_LINE.test(ct) || BANNER_LINE.test(ct)) break
          cmdLines.push(lines[j])
          const m = lines[j].trimEnd().match(CMD_CWD)
          if (m) {
            cwd = m[1]
            j++
            break
          }
        }
        const commandRaw = cmdLines.join('\n')
        const command = (cwd ? commandRaw.replace(CMD_CWD, '') : commandRaw).trim()
        if (command) entries.push({ kind: 'command', command, cwd, status: 'unknown' })
        i = j - 1
      }
      continue
    }
    const m = markerEntry(t)
    if (m && mode === 'text') {
      flush()
      entries.push(m)
      continue
    }
    buf.push(lines[i])
  }
  flush()
  if (banner) appendBanner(entries, banner)
  return entries
}

export function adapterFor(engine: string): RunLogAdapter {
  if (engine === 'claude' || engine === 'cursor') return claudeAdapter
  if (engine === 'codex' || engine === 'openrouter') return codexAdapter
  if (engine === 'hermes') return hermesAdapter
  return genericAdapter
}
