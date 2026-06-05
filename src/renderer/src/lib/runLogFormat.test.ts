import { describe, expect, test } from 'bun:test'
import { formatRunLog } from './runLogFormat'

describe('formatRunLog', () => {
  test('splits leading TerMinal metadata from output', () => {
    const out = formatRunLog('▸ Agent · claude\n▸ branch main\n▸ command codex exec -C <worktree> <prompt>\n\n━━ step 1/1 · run ━━\nhello')
    expect(out.meta).toEqual(['Agent · claude', 'branch main', 'command codex exec -C <worktree> <prompt>'])
    expect(out.lines.map((l) => l.kind)).toEqual(['step', 'normal'])
  })

  test('classifies deterministic stream markers without rewriting text', () => {
    const out = formatRunLog('[tool] Bash\nERROR failed\nDONE: ok\n# Heading\n- item\n```ts\nconst x = 1\n```\n')
    expect(out.lines.map((l) => l.kind)).toEqual([
      'tool',
      'error',
      'success',
      'heading',
      'list',
      'code',
      'code',
      'code',
      'blank',
    ])
    expect(out.lines[6].text).toBe('const x = 1')
  })
})
