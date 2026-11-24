import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTimelineMessage, readSessionTimeline } from './session-timeline'
import { findCodexSessionFile } from './transcripts/codex'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function fixture(rows: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'terminal-timeline-'))
  dirs.push(dir)
  const file = join(dir, 'session.jsonl')
  writeFileSync(
    file,
    rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n',
  )
  return file
}

test('parses user and assistant text, excluding tool results, metadata and malformed rows', () => {
  expect(parseTimelineMessage('{broken')).toBeNull()
  expect(
    parseTimelineMessage(
      JSON.stringify({ type: 'user', isMeta: true, message: { content: 'system context' } }),
    ),
  ).toBeNull()
  expect(
    parseTimelineMessage(
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', content: 'output' }] },
      }),
    ),
  ).toBeNull()
  expect(
    parseTimelineMessage(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } }),
    )?.text,
  ).toBe('Done')
})

test('turns retain source lines and collect assistant context without tool-result turns', async () => {
  const file = fixture([
    { type: 'user', timestamp: '2026-09-07T12:00:00Z', message: { content: 'First request' } },
    '{broken',
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'tool output' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'First answer' }] } },
    { type: 'user', message: { content: 'Next request' } },
  ])
  const result = await readSessionTimeline('claude-id', file)
  expect(result.turns.map((t) => [t.line, t.prompt, t.response])).toEqual([
    [1, 'First request', 'First answer'],
    [5, 'Next request', ''],
  ])
  expect(result.turns[0].timestamp).toBe(Date.parse('2026-09-07T12:00:00Z'))
  expect(result.sessionId).toBe('claude-id')
})

test('Codex paired event/response records count once, genuine repeated prompts remain', async () => {
  const file = fixture([
    { type: 'event_msg', payload: { type: 'user_message', message: 'Do it' } },
    {
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Do it' }] },
    },
    {
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Done' }],
      },
    },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Do it' } },
  ])
  const result = await readSessionTimeline('codex-id', file)
  expect(result.turns).toHaveLength(2)
  expect(result.turns[0].response).toBe('Done')
})

test('missing and oversized transcripts report an explicit unavailable state', async () => {
  expect((await readSessionTimeline('none', null)).error).toBeTruthy()
  const file = fixture([{ type: 'user', message: { content: 'Long prompt' } }])
  expect((await readSessionTimeline('large', file, { maxBytes: 1 })).error).toBeTruthy()
})

test('locates Codex rollouts in date directories by exact session id', () => {
  const file = fixture([])
  const root = file.slice(0, file.lastIndexOf('/'))
  const nested = join(root, '2026', '09', '07')
  mkdirSync(nested, { recursive: true })
  const rollout = join(nested, 'rollout-2026-09-07T12-00-00-codex-id.jsonl')
  writeFileSync(rollout, '')
  expect(findCodexSessionFile('codex-id', root)).toBe(rollout)
  expect(findCodexSessionFile('other-id', root)).toBeNull()
  expect(findCodexSessionFile('../codex-id', root)).toBeNull()
})

test('bounds retained turns and text, and refreshes a changed file', async () => {
  const file = fixture(
    Array.from({ length: 4 }, (_, i) => ({
      type: 'user',
      message: { content: `${i}${'x'.repeat(7000)}` },
    })),
  )
  const result = await readSessionTimeline('bounded', file, { maxTurns: 2 })
  expect(result.turns).toHaveLength(2)
  expect(result.truncated).toBe(true)
  expect(result.turns[0].line).toBe(3)
  expect(result.turns[0].prompt.length).toBeLessThanOrEqual(6001)
  writeFileSync(file, JSON.stringify({ type: 'user', message: { content: 'Changed' } }) + '\n')
  expect((await readSessionTimeline('bounded', file)).turns[0].prompt).toBe('Changed')
})
