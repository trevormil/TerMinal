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

export type FormattedLog = {
  meta: string[]
  lines: { text: string; kind: LogLineKind }[]
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
  const body = lines.slice(i).map((line) => {
    const trimmed = line.trim()
    const fence = /^```/.test(trimmed)
    const kind = fence ? 'code' : classifyLine(line, inFence)
    if (fence) inFence = !inFence
    return { text: line, kind }
  })

  return { meta, lines: body }
}
