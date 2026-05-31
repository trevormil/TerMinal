import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCodexSessionFile, parseCursorSessionFile } from './data'

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
    const dir = join(root, 'Users-trevormiller-CompSci-gauntlet-demo', 'agent-transcripts', id)
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
      cwd: '/Users/trevormiller/CompSci/gauntlet/demo',
      model: 'cursor',
      turns: 1,
      firstUserText: 'ship the cursor feature',
    })
  })
})
