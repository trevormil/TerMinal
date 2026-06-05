import { describe, expect, test } from 'bun:test'
import { formatRunLog } from './runLogFormat'

describe('formatRunLog', () => {
  test('splits leading TerMinal metadata from output', () => {
    const out = formatRunLog('▸ Agent · claude\n▸ branch main\n▸ command codex exec -C <worktree> <prompt>\n\n━━ step 1/1 · run ━━\nhello')
    expect(out.meta).toEqual(['Agent · claude', 'branch main', 'command codex exec -C <worktree> <prompt>'])
    expect(out.highlights).toEqual([])
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

  test('extracts deterministic highlights without parsing arbitrary markdown', () => {
    const out = formatRunLog('# Not a rendered document\n[tool] Bash\nMR: https://gitlab.example.com/acme/app/-/merge_requests/7\nDONE: shipped it\nFAILED: not this one\n[tool] Bash\n')
    expect(out.highlights).toEqual([
      { kind: 'tool', label: 'Tool', value: 'Bash' },
      {
        kind: 'link',
        label: 'MR',
        value: 'https://gitlab.example.com/acme/app/-/merge_requests/7',
        url: 'https://gitlab.example.com/acme/app/-/merge_requests/7',
      },
      { kind: 'done', label: 'Done', value: 'shipped it' },
      { kind: 'failed', label: 'Failed', value: 'not this one' },
    ])
    expect(out.lines[0]).toEqual({ text: '# Not a rendered document', kind: 'heading' })
  })
})
