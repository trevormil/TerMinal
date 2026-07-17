import { describe, expect, it } from 'bun:test'
import { parseRunLog } from './parse'
import type { RunLogEntry } from './types'

const kinds = (entries: RunLogEntry[]) => entries.map((e) => e.kind)
const find = <K extends RunLogEntry['kind']>(entries: RunLogEntry[], kind: K) =>
  entries.filter((e): e is Extract<RunLogEntry, { kind: K }> => e.kind === kind)

// ---- codex exec (also or-agent / openrouter) --------------------------------

// Modeled on a real cron-run log (codex exec v0.133): banner block, `user`
// prompt section, `codex` assistant sections, `exec` commands with FIFO-paired
// result blocks, interleaved hook noise, trailing token summary.
const CODEX_LOG = [
  '▸ Process feedback · codex',
  '▸ branch cron/beacon-123',
  "▸ codex exec -s danger-full-access -C '/tmp/wt' 'Act as the agent.'",
  '',
  'OpenAI Codex v0.133.0',
  '--------',
  'workdir: /tmp/wt',
  'model: gpt-5.5',
  'provider: openai',
  'approval: never',
  'sandbox: danger-full-access',
  'session id: 019e7ada-3584-71b1-80f3-44810bf0e220',
  '--------',
  'user',
  'Act as the agent for THIS repository. Drain the queue into tickets.',
  'codex',
  "I'll resolve the config first, then poll the queue.",
  'hook: PreToolUse',
  'hook: PreToolUse Completed',
  'exec',
  "/bin/zsh -lc 'cat config.json' in /tmp/wt",
  'exec',
  "/bin/zsh -lc 'printenv FOO' in /tmp/wt",
  ' succeeded in 12ms:',
  '{ "endpoint": "https://example.com" }',
  ' exited 1 in 3ms:',
  'exec',
  "/bin/zsh -lc 'git status --short' in /tmp/wt",
  ' succeeded in 163ms:',
  '## cron/beacon-123',
  '',
  'codex',
  'Config resolved; queue drained.',
  'tokens used: 12,345',
].join('\n')

describe('parseRunLog · codex exec', () => {
  const parsed = parseRunLog(CODEX_LOG)

  it('sniffs the engine from the meta header', () => {
    expect(parsed.engine).toBe('codex')
    expect(parsed.structured).toBe(true)
  })

  it('extracts the ▸ meta header', () => {
    const meta = find(parsed.entries, 'meta')
    expect(meta).toHaveLength(1)
    expect(meta[0].lines[0]).toBe('Process feedback · codex')
    expect(meta[0].lines).toHaveLength(3)
  })

  it('captures the engine banner including the config block', () => {
    const banners = find(parsed.entries, 'banner')
    expect(banners).toHaveLength(1)
    expect(banners[0].lines[0]).toContain('OpenAI Codex v0.133.0')
    expect(banners[0].lines).toContain('model: gpt-5.5')
  })

  it('captures the user prompt section', () => {
    const prompts = find(parsed.entries, 'prompt')
    expect(prompts).toHaveLength(1)
    expect(prompts[0].text).toContain('Drain the queue into tickets.')
  })

  it('captures assistant messages and drops hook noise', () => {
    const assist = find(parsed.entries, 'assistant')
    expect(assist).toHaveLength(2)
    expect(assist[0].text).toContain('resolve the config first')
    expect(assist[1].text).toBe('Config resolved; queue drained.')
    expect(JSON.stringify(parsed.entries)).not.toContain('hook: PreToolUse')
  })

  it('pairs exec commands with result blocks FIFO and strips the trailing cwd', () => {
    const cmds = find(parsed.entries, 'command')
    expect(cmds).toHaveLength(3)
    expect(cmds[0].command).toBe("/bin/zsh -lc 'cat config.json'")
    expect(cmds[0].status).toBe('ok')
    expect(cmds[0].durationMs).toBe(12)
    expect(cmds[0].output).toContain('"endpoint"')
    expect(cmds[1].command).toBe("/bin/zsh -lc 'printenv FOO'")
    expect(cmds[1].status).toBe('error')
    expect(cmds[1].exitCode).toBe(1)
    expect(cmds[2].status).toBe('ok')
    expect(cmds[2].output).toBe('## cron/beacon-123')
  })

  it('parses the token summary', () => {
    const sums = find(parsed.entries, 'summary')
    expect(sums).toHaveLength(1)
    expect(sums[0].tokens).toBe(12345)
  })
})

describe('parseRunLog · or-agent (openrouter) with ANSI wrapping', () => {
  // or-agent wraps every codex line in color escapes and adds its own
  // banner/summary lines; the decoder noise lines survive in cron logs.
  const wrap = (s: string) => `\x1b[0m\x1b[31m${s}\x1b[0m`
  const log = [
    '▸ Implement #14 · openrouter · as 1000x AI engineer',
    '▸ branch agent/ticket-14 (off main)',
    '',
    wrap('or-agent: running codex on deepseek/deepseek-chat (dir=/tmp/wt, today=$0.0000/$3)'),
    wrap('Reading additional input from stdin...'),
    wrap('OpenAI Codex v0.142.5'),
    wrap('--------'),
    wrap('workdir: /tmp/wt'),
    wrap('model: deepseek/deepseek-chat'),
    wrap('--------'),
    wrap('user'),
    wrap('Implement ticket #14.'),
    wrap('codex'),
    wrap('Done — opened the PR.'),
    wrap('or-agent: done — cost $0.0042 (today $0.0042/$3)'),
  ].join('\n')
  const parsed = parseRunLog(log)

  it('resolves openrouter from the meta header and strips ANSI', () => {
    expect(parsed.engine).toBe('openrouter')
    expect(JSON.stringify(parsed.entries)).not.toContain('\\u001b')
  })

  it('treats or-agent chatter as banner, not transcript', () => {
    const banners = find(parsed.entries, 'banner')
    expect(banners.some((b) => b.lines.some((l) => l.includes('or-agent: running')))).toBe(true)
    expect(JSON.stringify(parsed.entries)).not.toContain('Reading additional input')
  })

  it('parses the cost from the or-agent done line', () => {
    const sums = find(parsed.entries, 'summary')
    expect(sums).toHaveLength(1)
    expect(sums[0].costUsd).toBe(0.0042)
  })

  it('still captures prompt and assistant message', () => {
    expect(find(parsed.entries, 'prompt')[0].text).toBe('Implement ticket #14.')
    expect(find(parsed.entries, 'assistant')[0].text).toBe('Done — opened the PR.')
  })
})

// ---- claude stream-json (raw JSONL) -----------------------------------------

const CLAUDE_STREAM = [
  '{"type":"system","subtype":"init","model":"claude-opus-4-8","session_id":"abc"}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"Let me read the file."}]}}',
  '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"bun test"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","content":[{"type":"text","text":"3 pass, 0 fail"}]}]}}',
  '{"type":"assistant","message":{"content":[{"type":"text","text":"All green."}]}}',
  '{"type":"result","subtype":"success","total_cost_usd":0.1234,"duration_ms":45000,"result":"Done."}',
].join('\n')

describe('parseRunLog · claude stream-json', () => {
  const parsed = parseRunLog(CLAUDE_STREAM, 'claude')

  it('is structured', () => {
    expect(parsed.structured).toBe(true)
  })

  it('extracts assistant text turns', () => {
    const assist = find(parsed.entries, 'assistant')
    expect(assist.map((a) => a.text)).toEqual(['Let me read the file.', 'All green.'])
  })

  it('pairs tool_use with its tool_result by id', () => {
    const tools = find(parsed.entries, 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('Bash')
    expect(tools[0].input).toContain('bun test')
    expect(tools[0].output).toBe('3 pass, 0 fail')
    expect(tools[0].status).toBe('ok')
  })

  it('parses the result event into a summary', () => {
    const sums = find(parsed.entries, 'summary')
    expect(sums).toHaveLength(1)
    expect(sums[0].costUsd).toBe(0.1234)
    expect(sums[0].durationMs).toBe(45000)
    expect(sums[0].text).toBe('Done.')
  })

  it('marks errored tool results', () => {
    const p = parseRunLog(
      [
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"false"}}]}}',
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"exit 1"}]}}',
      ].join('\n'),
      'claude',
    )
    const tools = find(p.entries, 'tool')
    expect(tools[0].status).toBe('error')
    expect(tools[0].output).toBe('exit 1')
  })

  it('keeps truncated JSON lines as text instead of dropping them', () => {
    const p = parseRunLog(`${CLAUDE_STREAM}\n{"type":"assistant","mess`, 'claude')
    const texts = find(p.entries, 'text')
    expect(texts.some((t) => t.text.includes('{"type":"assistant","mess'))).toBe(true)
    // and everything before it still parsed
    expect(find(p.entries, 'tool')).toHaveLength(1)
  })

  it('keeps interleaved non-JSON noise between events', () => {
    const p = parseRunLog(
      [
        '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
        'warning: some stderr line',
        '{"type":"result","total_cost_usd":0.01}',
      ].join('\n'),
      'claude',
    )
    expect(JSON.stringify(p.entries)).toContain('warning: some stderr line')
  })
})

describe('parseRunLog · claude decoded text (live agent runs)', () => {
  // What agents.ts actually stores after createAgentStreamDecoder flattens the
  // stream: meta header, assistant prose, [tool] breadcrumbs, [usage] trailer.
  const log = [
    '▸ Fix bug · claude',
    '▸ branch agent/fix-1 (off main)',
    '▸ worktree /tmp/wt',
    '',
    'Let me look at the failing test.',
    '[tool] Bash',
    '[tool] Edit',
    'Now the fix is in place.',
    '[usage · $0.0421 · 33.2s]',
  ].join('\n')
  const parsed = parseRunLog(log)

  it('sniffs claude from the meta header', () => {
    expect(parsed.engine).toBe('claude')
  })

  it('turns prose into assistant entries and breadcrumbs into tools', () => {
    expect(kinds(parsed.entries)).toEqual([
      'meta',
      'assistant',
      'tool',
      'tool',
      'assistant',
      'summary',
    ])
    const tools = find(parsed.entries, 'tool')
    expect(tools.map((t) => t.name)).toEqual(['Bash', 'Edit'])
  })

  it('parses the decoded usage trailer', () => {
    const sums = find(parsed.entries, 'summary')
    expect(sums[0].costUsd).toBe(0.0421)
    expect(sums[0].durationMs).toBe(33200)
  })

  it('surfaces [spawn error] as an error entry', () => {
    const p = parseRunLog('▸ t · claude\n\n[spawn error] spawn claude ENOENT\n')
    const errs = find(p.entries, 'error')
    expect(errs).toHaveLength(1)
    expect(errs[0].text).toContain('ENOENT')
  })
})

describe('parseRunLog · cursor stream-json', () => {
  it('treats text events as assistant output', () => {
    const p = parseRunLog(
      ['{"type":"text","text":"hel"}', '{"type":"text","text":"lo"}'].join('\n'),
      'cursor',
    )
    const assist = find(p.entries, 'assistant')
    expect(assist).toHaveLength(1)
    expect(assist[0].text).toBe('hello')
  })
})

// ---- step markers (engine-agnostic) -----------------------------------------

describe('parseRunLog · multi-step runs', () => {
  const log = [
    '▸ Multi · codex',
    '',
    '━━ step 1/2 · implement ━━',
    '',
    'codex',
    'step one done',
    '',
    '━━ step 1/2 end (exit 0) ━━',
    '━━ step 2/2 · review ━━',
    '',
    'codex',
    'step two failed',
    '',
    '━━ step 2/2 end (exit 1) ━━',
  ].join('\n')
  const parsed = parseRunLog(log)

  it('emits step boundaries with paired exit status', () => {
    const steps = find(parsed.entries, 'step')
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({ n: 1, total: 2, label: 'implement', status: 'ok', exitCode: 0 })
    expect(steps[1]).toMatchObject({ n: 2, total: 2, label: 'review', status: 'failed', exitCode: 1 })
  })

  it('keeps content between markers attached in order', () => {
    const seq = kinds(parsed.entries)
    expect(seq.indexOf('step')).toBeLessThan(seq.indexOf('assistant'))
  })

  it('leaves an unterminated step as running', () => {
    const p = parseRunLog('━━ step 1/1 · go ━━\nworking...\n')
    expect(find(p.entries, 'step')[0].status).toBe('running')
  })
})

// ---- graceful degradation ---------------------------------------------------

describe('parseRunLog · graceful degradation', () => {
  it('returns structured:false for plain unstructured text', () => {
    const p = parseRunLog('just some shell output\nanother line\n')
    expect(p.structured).toBe(false)
    expect(find(p.entries, 'text')).toHaveLength(1)
    expect(find(p.entries, 'text')[0].text).toContain('another line')
  })

  it('returns no entries for empty input', () => {
    expect(parseRunLog('').entries).toEqual([])
    expect(parseRunLog('').structured).toBe(false)
    expect(parseRunLog('  \n \n').entries).toEqual([])
  })

  it('meta-only logs are not considered structured', () => {
    const p = parseRunLog('▸ Agent · hermes\n▸ branch x\n')
    expect(p.structured).toBe(false)
    expect(find(p.entries, 'meta')).toHaveLength(1)
  })

  it('hermes output falls back to text blocks but keeps generic markers', () => {
    const p = parseRunLog('▸ t · hermes\n\nthinking about it\n[tool] apply_patch\nall done\n')
    expect(p.engine).toBe('hermes')
    const tools = find(p.entries, 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('apply_patch')
    expect(find(p.entries, 'text')).toHaveLength(2)
  })

  it('never drops content: every input line survives somewhere', () => {
    const lines = ['alpha', '{"type":"assistant","mess', '[tool] Bash', 'omega']
    const p = parseRunLog(lines.join('\n'), 'claude')
    const blob = JSON.stringify(p.entries)
    // markers may be re-shaped (e.g. "[tool] Bash" → a tool entry named Bash),
    // but the information itself must survive.
    for (const probe of ['alpha', '{\\"type\\":\\"assistant\\",\\"mess', 'Bash', 'omega'])
      expect(blob).toContain(probe)
  })

  it('unknown engine hint falls back to content sniffing', () => {
    const p = parseRunLog('OpenAI Codex v0.99.0\n--------\nmodel: x\n--------\nuser\nhi\n')
    expect(p.engine).toBe('codex')
    expect(find(p.entries, 'prompt')).toHaveLength(1)
  })
})
