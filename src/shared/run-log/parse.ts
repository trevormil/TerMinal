// Pure run-log parser: string in → typed entries out (ticket 0020).
// Engine-aware via per-engine adapters; step markers and the `▸` meta header
// are engine-agnostic runner conventions handled here.

import { adapterFor } from './adapters'
import { sanitizeLog } from './sanitize'
import type { ParsedRunLog, RunLogEntry, RunLogStepStatus } from './types'

const STEP_START = /^━━ step (\d+)\/(\d+) · (.+) ━━$/
const STEP_END = /^━━ step (\d+)\/(\d+) end \(exit (-?\d+)\) ━━$/

const KNOWN_ENGINES = ['claude', 'codex', 'cursor', 'openrouter', 'hermes']

// Entry kinds that make a log worth showing structured; meta/banner/text alone
// mean we learned nothing beyond the raw view.
const STRUCTURED_KINDS = new Set<RunLogEntry['kind']>([
  'step',
  'prompt',
  'assistant',
  'reasoning',
  'tool',
  'command',
  'error',
  'summary',
])

function resolveEngine(hint: string | undefined, metaLines: string[], body: string): string {
  if (hint && KNOWN_ENGINES.includes(hint)) return hint
  // agents.ts / terminal-cron header: `▸ <title> · <engine>[ · as <persona>…]`
  const tokens = (metaLines[0] || '').split(' · ').map((s) => s.trim())
  for (const t of tokens) if (KNOWN_ENGINES.includes(t)) return t
  if (/^(?:\[[^\]]*\]\s*)?OpenAI Codex v/m.test(body) || /^or-agent: /m.test(body)) return 'codex'
  if (/^\s*\{"type":/m.test(body)) return 'claude'
  return hint || ''
}

export function parseRunLog(raw: string, engineHint?: string): ParsedRunLog {
  const text = sanitizeLog(raw || '')
  if (!text.trim()) return { engine: engineHint || '', entries: [], structured: false }

  const lines = text.split('\n')
  const meta: string[] = []
  let i = 0
  while (i < lines.length && lines[i].trim().startsWith('▸')) {
    meta.push(lines[i].trim().replace(/^▸\s*/, ''))
    i++
  }

  const engine = resolveEngine(engineHint, meta, lines.slice(i).join('\n'))
  const adapter = adapterFor(engine)

  const entries: RunLogEntry[] = []
  if (meta.length) entries.push({ kind: 'meta', lines: meta })

  const steps: Extract<RunLogEntry, { kind: 'step' }>[] = []
  let segment: string[] = []
  const flushSegment = () => {
    if (segment.some((l) => l.trim())) entries.push(...adapter(segment))
    segment = []
  }
  for (; i < lines.length; i++) {
    const t = lines[i].trim()
    const start = t.match(STEP_START)
    if (start) {
      flushSegment()
      const step = {
        kind: 'step' as const,
        n: Number(start[1]),
        total: Number(start[2]),
        label: start[3],
        status: 'running' as RunLogStepStatus,
      }
      entries.push(step)
      steps.push(step)
      continue
    }
    const end = t.match(STEP_END)
    if (end) {
      flushSegment()
      const n = Number(end[1])
      const step = [...steps].reverse().find((s) => s.n === n && s.status === 'running')
      if (step) {
        step.exitCode = Number(end[3])
        step.status = step.exitCode === 0 ? 'ok' : 'failed'
      }
      continue
    }
    segment.push(lines[i])
  }
  flushSegment()

  return { engine, entries, structured: entries.some((e) => STRUCTURED_KINDS.has(e.kind)) }
}
