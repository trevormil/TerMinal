import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseCodexSessionFile,
  parseCursorSessionFile,
  parseObservabilityIndexRecordsFile,
  parseTranscriptDetailFile,
  parseTranscriptFile,
} from './data'

describe('parseCodexSessionFile', () => {
  test('extracts picker metadata from Codex JSONL sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminal-codex-session-'))
    const file = join(dir, 'rollout-2026-05-30T10-00-00-019e-test.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: '019e-test', cwd: '/tmp/repo' },
        }),
        JSON.stringify({
          type: 'turn_context',
          payload: { model: 'gpt-5.5', cwd: '/tmp/repo' },
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'ship the feature' },
        }),
      ].join('\n'),
    )

    expect(parseCodexSessionFile(file)).toMatchObject({
      id: '019e-test',
      engine: 'codex',
      cwd: '/tmp/repo',
      model: 'gpt-5.5',
      turns: 1,
      firstUserText: 'ship the feature',
    })
  })
})

describe('parseCursorSessionFile', () => {
  test('extracts picker metadata from Cursor agent transcripts', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'terminal-cursor-home-')), 'projects')
    const id = '11111111-2222-3333-4444-555555555555'
    const dir = join(root, 'Users-example-projects-demo', 'agent-transcripts', id)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${id}.jsonl`)
    writeFileSync(
      file,
      [
        JSON.stringify({
          role: 'user',
          message: {
            content: [
              {
                type: 'text',
                text: '<timestamp>2026-05-31</timestamp><user_query>ship the cursor feature</user_query>',
              },
            ],
          },
        }),
        JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }),
      ].join('\n'),
    )

    expect(parseCursorSessionFile(file)).toMatchObject({
      id,
      engine: 'cursor',
      cwd: '/Users/example/projects/demo',
      model: 'cursor',
      turns: 1,
      firstUserText: 'ship the cursor feature',
    })
  })
})

describe('parseTranscriptFile', () => {
  test('extracts observability telemetry from Claude JSONL transcripts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminal-claude-session-'))
    const file = join(dir, 'session.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify({ type: 'ai-title', aiTitle: 'Prompt enhancement work' }),
        JSON.stringify({
          cwd: '/tmp/repo',
          gitBranch: 'feature/observability',
          message: { role: 'user', content: 'Add an observability tab' },
        }),
        JSON.stringify({
          cwd: '/tmp/repo',
          gitBranch: 'feature/observability',
          message: {
            role: 'assistant',
            id: 'msg-1',
            model: 'claude-opus-4-1-20250805',
            usage: {
              input_tokens: 1000,
              cache_creation_input_tokens: 200,
              cache_read_input_tokens: 300,
              output_tokens: 50,
            },
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/repo/src/main/data.ts' } },
              { type: 'tool_use', name: 'Bash', input: { command: 'bun test' } },
              {
                type: 'tool_use',
                id: 'task-1',
                name: 'Task',
                input: { subagent_type: 'researcher', description: 'Map observability gaps' },
              },
            ],
          },
        }),
        JSON.stringify({
          cwd: '/tmp/repo',
          gitBranch: 'feature/observability',
          message: {
            role: 'assistant',
            id: 'msg-1',
            model: 'claude-opus-4-1-20250805',
            usage: {
              input_tokens: 1000,
              cache_creation_input_tokens: 200,
              cache_read_input_tokens: 300,
              output_tokens: 50,
            },
            content: [
              { type: 'text', text: 'done' },
              {
                type: 'tool_use',
                id: 'task-1',
                name: 'Task',
                input: { subagent_type: 'researcher', description: 'Map observability gaps' },
              },
            ],
          },
        }),
        JSON.stringify({
          cwd: '/tmp/repo',
          gitBranch: 'feature/observability',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'task-1', content: 'agent complete' }],
          },
        }),
      ].join('\n'),
    )

    expect(parseTranscriptFile(file, 'session-1')).toMatchObject({
      ok: true,
      sessionId: 'session-1',
      model: 'claude-opus-4-1-20250805',
      cwd: '/tmp/repo',
      gitBranch: 'feature/observability',
      aiTitle: 'Prompt enhancement work',
      firstUserText: 'Add an observability tab',
      contextTokens: 1550,
      totalInputTokens: 1500,
      totalOutputTokens: 50,
      turns: 1,
      lastAction: { tool: 'Task', detail: 'Map observability gaps' },
      toolCounts: { Read: 1, Bash: 1, Task: 1 },
    })
  })

  test('extracts AgentView-style timeline facts from Claude JSONL transcripts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminal-claude-detail-'))
    const file = join(dir, 'session.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify({
          timestamp: '2026-06-01T10:00:00.000Z',
          message: { role: 'user', content: 'Run tests' },
        }),
        JSON.stringify({
          timestamp: '2026-06-01T10:00:01.000Z',
          message: {
            id: 'msg-detail-1',
            role: 'assistant',
            usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 },
            content: [
              { type: 'thinking', thinking: 'Need command' },
              { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'bun test' } },
              { type: 'tool_use', id: 'task-1', name: 'Task', input: { subagent_type: 'qa', description: 'Inspect failures' } },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-01T10:00:01.500Z',
          message: {
            id: 'msg-detail-1',
            role: 'assistant',
            usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 },
            content: [
              { type: 'text', text: 'running tests' },
              { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'bun test' } },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-01T10:00:02.000Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: '3 pass' }],
          },
        }),
      ].join('\n'),
    )

    const detail = parseTranscriptDetailFile(file, 'session-1')
    expect(detail.events).toContainEqual(expect.objectContaining({ kind: 'tool_call', toolName: 'Bash', commandPreview: 'bun test' }))
    expect(detail.events).toContainEqual(expect.objectContaining({ kind: 'agent_launch', toolName: 'Task', agentRole: 'qa' }))
    expect(detail.toolCalls).toContainEqual(expect.objectContaining({ callId: 'bash-1', status: 'ok', outputPreview: '3 pass' }))
    expect(detail.tokenSnapshots).toEqual([
      expect.objectContaining({ input: 12, cachedInput: 3, output: 4, total: 19, cumulativeTotal: 19 }),
    ])
    expect(detail.graph.nodes).toContainEqual(expect.objectContaining({ role: 'qa', status: 'open', taskPreview: 'Inspect failures' }))
  })
})

describe('parseObservabilityIndexRecordsFile', () => {
  test('captures full request/response JSON, errors, and the complete event stream', () => {
    const dir = mkdtempSync(join(tmpdir(), 'terminal-obs-records-'))
    const file = join(dir, 'session.jsonl')
    writeFileSync(
      file,
      [
        JSON.stringify({ timestamp: '2026-06-01T10:00:00.000Z', message: { role: 'user', content: 'Run the tests' } }),
        JSON.stringify({
          timestamp: '2026-06-01T10:00:01.000Z',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'I should run bun test first' },
              { type: 'text', text: 'Running the suite now' },
              { type: 'tool_use', id: 'bash-ok', name: 'Bash', input: { command: 'bun test', description: 'run suite' } },
              { type: 'tool_use', id: 'edit-bad', name: 'Edit', input: { file_path: '/tmp/x.ts', old_string: 'a', new_string: 'b' } },
            ],
          },
        }),
        JSON.stringify({
          timestamp: '2026-06-01T10:00:02.000Z',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bash-ok', content: '3 pass 0 fail' }] },
        }),
        JSON.stringify({
          timestamp: '2026-06-01T10:00:03.000Z',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'edit-bad', is_error: true, content: 'String to replace not found' }] },
        }),
      ].join('\n'),
    )

    const records = parseObservabilityIndexRecordsFile(file, 'session-records')

    const bash = records.toolPayloads.find((p) => p.callId === 'bash-ok')
    expect(bash).toBeTruthy()
    expect(bash?.status).toBe('ok')
    expect(bash?.commandText).toBe('bun test')
    expect(bash?.inputText).toContain('"command": "bun test"') // full request JSON, not a preview
    expect(bash?.outputText).toBe('3 pass 0 fail')
    expect(bash?.errorText).toBe('')
    expect(bash?.truncated).toBe(false)

    const edit = records.toolPayloads.find((p) => p.callId === 'edit-bad')
    expect(edit?.status).toBe('error')
    expect(edit?.inputText).toContain('"new_string": "b"')
    expect(edit?.errorText).toBe('String to replace not found') // error output captured verbatim

    // Full chronological stream with untruncated text, seq-ordered.
    const kinds = records.events.map((e) => e.kind)
    expect(kinds).toEqual(['user_message', 'reasoning', 'assistant_message', 'tool_call', 'tool_call', 'tool_result', 'tool_result'])
    expect(records.events[0]).toMatchObject({ seq: 0, role: 'user', text: 'Run the tests' })
    expect(records.events[1]).toMatchObject({ kind: 'reasoning', text: 'I should run bun test first' })
    expect(records.events.every((e, i) => e.seq === i)).toBe(true)
  })
})
