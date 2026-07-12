export type LogLineKind =
  | 'blank'
  | 'heading'
  | 'list'
  | 'code'
  | 'step'
  | 'tool'
  | 'error'
  | 'success'
  | 'command'
  | 'meta'
  | 'normal'

export type LogHighlight = {
  kind: 'link' | 'done' | 'failed' | 'tool'
  label: string
  value: string
  url?: string
}

// A parsed step in a multi-step run — paired start (`━━ step N/M · label ━━`)
// and end (`━━ step N/M end (exit C) ━━`) markers the runner emits (#3). `line`
// is the 0-based index of the START marker in the formatted body, for jump-to.
export type LogStep = {
  n: number
  total: number
  label: string
  exitCode?: number
  status: 'running' | 'ok' | 'failed'
  line: number
}

export type FormattedLog = {
  meta: string[]
  highlights: LogHighlight[]
  steps: LogStep[]
  lines: { text: string; kind: LogLineKind }[]
}

const STEP_START = /^━━ step (\d+)\/(\d+) · (.+) ━━$/
const STEP_END = /^━━ step (\d+)\/(\d+) end \(exit (-?\d+)\) ━━$/

// Pair step start/end markers into structured steps over the body lines.
export function parseSteps(bodyLines: string[]): LogStep[] {
  const steps: LogStep[] = []
  bodyLines.forEach((raw, idx) => {
    const line = raw.trim()
    const start = line.match(STEP_START)
    if (start) {
      steps.push({ n: Number(start[1]), total: Number(start[2]), label: start[3], status: 'running', line: idx })
      return
    }
    const end = line.match(STEP_END)
    if (end) {
      const n = Number(end[1])
      const exitCode = Number(end[3])
      const step = [...steps].reverse().find((s) => s.n === n && s.status === 'running')
      if (step) {
        step.exitCode = exitCode
        step.status = exitCode === 0 ? 'ok' : 'failed'
      }
    }
  })
  return steps
}

function classifyLine(line: string, inFence: boolean): LogLineKind {
  const trimmed = line.trim()
  if (!trimmed) return 'blank'
  if (inFence) return 'code'
  if (trimmed.startsWith('▸')) return 'meta'
  if (/^━━ .* ━━$/.test(trimmed)) return 'step'
  if (/^\[(tool|usage|spawn error)\]/i.test(trimmed)) return trimmed.toLowerCase().includes('error') ? 'error' : 'tool'
  if (/^(error|failed|fatal|exception|traceback)\b/i.test(trimmed)) return 'error'
  if (/^(done|success|passed|mr:|pr:)\b/i.test(trimmed)) return 'success'
  if (/^(bash|shell|command|\$|>)\b/i.test(trimmed)) return 'command'
  if (/^#{1,6}\s+/.test(trimmed)) return 'heading'
  if (/^([-*+]|\d+\.)\s+/.test(trimmed)) return 'list'
  return 'normal'
}

function highlightFromLine(line: string): LogHighlight | null {
  const trimmed = line.trim()
  const link = trimmed.match(/^(MR|PR):\s*(https?:\/\/\S+)/i)
  if (link) {
    return {
      kind: 'link',
      label: link[1].toUpperCase(),
      value: link[2],
      url: link[2],
    }
  }
  const done = trimmed.match(/^DONE:\s*(.+)$/i)
  if (done) return { kind: 'done', label: 'Done', value: done[1].trim() }
  const failed = trimmed.match(/^FAILED:\s*(.+)$/i)
  if (failed) return { kind: 'failed', label: 'Failed', value: failed[1].trim() }
  const tool = trimmed.match(/^\[tool\]\s*(.+)$/i)
  if (tool) return { kind: 'tool', label: 'Tool', value: tool[1].trim() }
  return null
}

function uniqueHighlights(lines: string[]): LogHighlight[] {
  const seen = new Set<string>()
  const out: LogHighlight[] = []
  for (const line of lines) {
    const h = highlightFromLine(line)
    if (!h) continue
    const key = `${h.kind}:${h.label}:${h.value}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(h)
    if (out.length >= 8) break
  }
  return out
}

export function formatRunLog(text: string): FormattedLog {
  const lines = text.split('\n')
  const meta: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      if (meta.length) i++
      break
    }
    if (!line.trim().startsWith('▸')) break
    meta.push(line.trim().replace(/^▸\s*/, ''))
    i++
  }

  let inFence = false
  const bodyLines = lines.slice(i)
  const body = bodyLines.map((line) => {
    const trimmed = line.trim()
    const fence = /^```/.test(trimmed)
    const kind = fence ? 'code' : classifyLine(line, inFence)
    if (fence) inFence = !inFence
    return { text: line, kind }
  })

  return { meta, highlights: uniqueHighlights(bodyLines), steps: parseSteps(bodyLines), lines: body }
}
