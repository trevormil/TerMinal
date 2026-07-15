import { describe, expect, test } from 'bun:test'
import { formatRunLog, parseSteps } from './runLogFormat'

describe('formatRunLog', () => {
  test('splits leading TerMinal metadata from output', () => {
    const out = formatRunLog(
      '▸ Agent · claude\n▸ branch main\n▸ command codex exec -C <worktree> <prompt>\n\n━━ step 1/1 · run ━━\nhello',
    )
    expect(out.meta).toEqual([
      'Agent · claude',
      'branch main',
      'command codex exec -C <worktree> <prompt>',
    ])
    expect(out.highlights).toEqual([])
    expect(out.lines.map((l) => l.kind)).toEqual(['step', 'normal'])
  })

  test('classifies deterministic stream markers without rewriting text', () => {
    const out = formatRunLog(
      '[tool] Bash\nERROR failed\nDONE: ok\n# Heading\n- item\n```ts\nconst x = 1\n```\n',
    )
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
    const out = formatRunLog(
      '# Not a rendered document\n[tool] Bash\nMR: https://gitlab.example.com/acme/app/-/merge_requests/7\nDONE: shipped it\nFAILED: not this one\n[tool] Bash\n',
    )
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

describe('parseSteps (#3 collapsible steps + jump-to-failure)', () => {
  test('pairs start/end markers into ok / failed steps with exit codes + line index', () => {
    const lines = [
      '━━ step 1/2 · build ━━',
      'compiling…',
      '━━ step 1/2 end (exit 0) ━━',
      '━━ step 2/2 · test ━━',
      'boom',
      '━━ step 2/2 end (exit 1) ━━',
    ]
    const steps = parseSteps(lines)
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({ n: 1, label: 'build', status: 'ok', exitCode: 0, line: 0 })
    expect(steps[1]).toMatchObject({ n: 2, label: 'test', status: 'failed', exitCode: 1, line: 3 })
  })
  test('an unfinished step (no end marker) stays running', () => {
    const steps = parseSteps(['━━ step 1/3 · lint ━━', 'working'])
    expect(steps[0].status).toBe('running')
    expect(steps[0].exitCode).toBeUndefined()
  })
  test('no step markers → empty; formatRunLog exposes steps', () => {
    expect(parseSteps(['plain', 'output'])).toEqual([])
    const f = formatRunLog('▸ header\n\n━━ step 1/1 · go ━━\nok\n━━ step 1/1 end (exit 0) ━━\n')
    expect(f.steps).toHaveLength(1)
    expect(f.steps[0].status).toBe('ok')
  })
})
