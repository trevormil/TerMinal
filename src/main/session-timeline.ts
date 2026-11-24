import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { isRecord, parseLine } from './transcript-schema'
import type { SessionTimeline, SessionTimelineTurn } from '../shared/types/session-timeline'

type Message = { role: 'user' | 'assistant'; text: string; source: string; timestamp?: number }
const clip = (text: string) => (text.length > 6000 ? `${text.slice(0, 6000)}…` : text)

export function parseTimelineMessage(line: string): Message | null {
  const row = parseLine(line)
  if (!row || row.isMeta || row.isSidechain) return null
  const payload = isRecord(row.payload) ? row.payload : null
  let message = isRecord(row.message) ? row.message : row
  let source = 'message'
  if (row.type === 'response_item') {
    if (payload?.type !== 'message') return null
    message = payload
    source = 'response_item'
  } else if (row.type === 'event_msg') {
    if (payload?.type !== 'user_message' || typeof payload.message !== 'string') return null
    message = { role: 'user', content: payload.message }
    source = 'event_msg'
  }
  const role = message.role ?? row.type
  if (role !== 'user' && role !== 'assistant') return null
  const content = message.content
  const text = (
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter(
              (b) =>
                isRecord(b) &&
                ['text', 'input_text', 'output_text'].includes(String(b.type)) &&
                typeof b.text === 'string',
            )
            .map((b) => b.text)
            .join('\n')
        : ''
  ).trim()
  if (!text) return null
  const timestamp =
    typeof row.timestamp === 'number'
      ? row.timestamp
      : typeof row.timestamp === 'string'
        ? Date.parse(row.timestamp)
        : NaN
  return { role, text: clip(text), source, ...(Number.isFinite(timestamp) ? { timestamp } : {}) }
}

// One snapshot only: disabled widgets do no work, unchanged transcripts do no rescanning.
let cached: { key: string; result: SessionTimeline } | undefined

export async function readSessionTimeline(
  sessionId: string,
  file: string | null,
  { maxBytes = 32 * 1024 * 1024, maxTurns = 500 } = {},
): Promise<SessionTimeline> {
  const unavailable = (error: string): SessionTimeline => ({ sessionId, turns: [], error })
  if (!file) return unavailable('No local transcript available for this session.')
  let stream: ReturnType<typeof createReadStream> | undefined
  let reader: ReturnType<typeof createInterface> | undefined
  try {
    const info = await stat(file)
    if (info.size > maxBytes)
      return unavailable('Timeline unavailable: transcript exceeds the 32 MB MVP limit.')
    const key = `${sessionId}\0${file}\0${info.mtimeMs}\0${info.size}\0${maxTurns}`
    if (cached?.key === key) return cached.result
    if (!info.size) return { sessionId, turns: [] }
    stream = createReadStream(file, { encoding: 'utf8', end: info.size - 1 })
    reader = createInterface({ input: stream, crlfDelay: Infinity })
    const turns: SessionTimelineTurn[] = []
    let line = 0
    let truncated = false
    let previousUser: Message | undefined
    for await (const raw of reader) {
      line++
      const message = parseTimelineMessage(raw)
      if (!message) continue
      if (message.role === 'user') {
        // Codex emits the same prompt as both an event and a response item.
        if (
          previousUser &&
          previousUser.source !== message.source &&
          previousUser.text === message.text &&
          [previousUser.source, message.source].every(
            (s) => s === 'event_msg' || s === 'response_item',
          )
        ) {
          previousUser = undefined
          continue
        }
        turns.push({ line, timestamp: message.timestamp, prompt: message.text, response: '' })
        previousUser = message
        if (turns.length > maxTurns) {
          turns.shift()
          truncated = true
        }
      } else {
        previousUser = undefined
        const turn = turns.at(-1)
        if (turn) turn.response = clip([turn.response, message.text].filter(Boolean).join('\n\n'))
      }
    }
    const result = { sessionId, turns, truncated }
    cached = { key, result }
    return result
  } catch {
    return unavailable('Could not read the local session transcript.')
  } finally {
    reader?.close()
    stream?.destroy()
  }
}
