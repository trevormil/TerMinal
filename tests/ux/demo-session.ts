// Seed a plausible live session for the README capture (ticket 98).
//
// HONESTY NOTE, because this matters: the numbers below are STAGED. They are
// not from a real work session. What is real is everything else — this is the
// actual app, reading the actual transcript format, rendering through the
// actual cockpit widgets. Nothing about the UI is mocked or drawn.
//
// It exists because the README hero's whole pitch is "a cockpit per session:
// context window, plan usage, the current tool call, todos, git state". Captured
// from a cold sandbox, all six of those render as empty states, so the hero
// advertises an app doing nothing. A sandbox has no live session by definition,
// so the choice is staged data or no cockpit.
//
// Only ever called from the README capture path, never from the test suite.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Matches the session the capture harness opens (launch-app.ts). */
export const DEMO_SESSION_ID = '00000000-0000-4000-8000-000000000001'

/**
 * Claude Code encodes the cwd into a directory name by replacing every
 * non-alphanumeric run with `-`. Getting this wrong means the transcript is
 * written somewhere the reader never looks, and the cockpit stays empty with no
 * error — so it is derived, not guessed.
 */
function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

type Line = Record<string, unknown>

/**
 * Write a transcript, a statusline cache entry and a todo list into `home`.
 *
 * @param home the sandbox HOME (so ~/.claude resolves inside it)
 * @param cwd  the fixture repo the session is "in"
 */
export function seedDemoSession(home: string, cwd: string): void {
  const now = Date.now()
  const iso = (msAgo: number): string => new Date(now - msAgo).toISOString()

  // ---- transcript ----------------------------------------------------------
  // The cockpit derives context tokens and cost from the usage on assistant
  // lines, so those have to be real fields, not decoration.
  const model = 'claude-opus-5'
  const lines: Line[] = [
    {
      type: 'user',
      uuid: 'u1',
      timestamp: iso(9 * 60_000),
      cwd,
      gitBranch: 'main',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Add rate limiting to the public API routes.' }],
      },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: iso(7 * 60_000),
      cwd,
      gitBranch: 'main',
      message: {
        role: 'assistant',
        model,
        content: [
          {
            type: 'text',
            text: 'Reading the route definitions and the existing middleware chain first.',
          },
          { type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'app.use(' } },
        ],
        usage: {
          input_tokens: 41_200,
          output_tokens: 1_180,
          cache_read_input_tokens: 12_400,
          cache_creation_input_tokens: 2_100,
        },
      },
    },
    {
      type: 'assistant',
      uuid: 'a2',
      timestamp: iso(90_000),
      cwd,
      gitBranch: 'main',
      message: {
        role: 'assistant',
        model,
        content: [
          { type: 'text', text: 'Adding a token-bucket limiter and a test for the 429 path.' },
          { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'bun test routes' } },
        ],
        usage: {
          input_tokens: 55_900,
          output_tokens: 2_340,
          cache_read_input_tokens: 38_700,
          cache_creation_input_tokens: 900,
        },
      },
    },
  ]

  const projDir = join(home, '.claude', 'projects', projectDirName(cwd))
  mkdirSync(projDir, { recursive: true })
  writeFileSync(
    join(projDir, `${DEMO_SESSION_ID}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  )

  // ---- todos ---------------------------------------------------------------
  // ~/.claude/tasks/<session>/<n>.json — drives the TODOS card.
  const tasksDir = join(home, '.claude', 'tasks', DEMO_SESSION_ID)
  mkdirSync(tasksDir, { recursive: true })
  writeFileSync(
    join(tasksDir, '1.json'),
    JSON.stringify(
      [
        { content: 'Read the existing middleware chain', status: 'completed' },
        { content: 'Add a token-bucket limiter', status: 'in_progress' },
        { content: 'Cover the 429 path with a test', status: 'pending' },
        { content: 'Document the limit in the API reference', status: 'pending' },
      ],
      null,
      2,
    ),
  )
}

/**
 * The statusline cache entry — model, context window and plan usage.
 *
 * Separate from the transcript because it lands in the CONFIG dir, not HOME,
 * and because Claude's statusLine is the authoritative source for
 * context_window_size (the transcript alone only supports a guess).
 */
export function seedDemoStatusline(configDir: string): void {
  const dir = join(configDir, 'statusline')
  mkdirSync(dir, { recursive: true })
  const resetsAt = Math.floor(Date.now() / 1000) + 2 * 3600
  writeFileSync(
    join(dir, `${DEMO_SESSION_ID}.json`),
    JSON.stringify(
      {
        model: { id: 'claude-opus-5', display_name: 'Opus' },
        context_window: { context_window_size: 1_000_000, used_percentage: 11.4 },
        rate_limits: {
          five_hour: { used_percentage: 34, resets_at: resetsAt },
          seven_day: { used_percentage: 18, resets_at: resetsAt + 5 * 86_400 },
        },
        cost: { total_cost_usd: 0.63 },
      },
      null,
      2,
    ),
  )
}

/**
 * Seed run history and schedules (ticket 98).
 *
 * The Runs and Schedules tabs are two of the five README tiles, and a cold
 * sandbox renders both as "nothing here yet" — which is an accurate picture of
 * an empty repo and a useless picture of the product. Same staging caveat as
 * above: the records are invented, the rendering is real.
 */
export function seedDemoRuns(configDir: string, repoRoot: string, repoLabel: string): void {
  const now = Date.now()
  const min = 60_000
  const runs = [
    {
      agentId: 'strengthen-tests',
      agentTitle: 'Strengthen tests',
      engine: 'claude',
      status: 'done',
      startedAt: now - 22 * min,
      endedAt: now - 18 * min,
      exitCode: 0,
      branch: 'agent/strengthen-tests',
    },
    {
      agentId: 'improve-docs',
      agentTitle: 'Improve docs',
      engine: 'codex',
      status: 'done',
      startedAt: now - 96 * min,
      endedAt: now - 91 * min,
      exitCode: 0,
      branch: 'agent/improve-docs',
    },
    {
      agentId: 'dependency-hygiene',
      agentTitle: 'Dependency hygiene',
      engine: 'claude',
      status: 'failed',
      startedAt: now - 8 * 60 * min,
      endedAt: now - 8 * 60 * min + 3 * min,
      exitCode: 1,
      branch: 'agent/dependency-hygiene',
      error: 'bun audit reported 1 high advisory',
    },
    {
      agentId: 'security-sweep',
      agentTitle: 'Security sweep',
      engine: 'codex',
      status: 'done',
      startedAt: now - 26 * 60 * min,
      endedAt: now - 26 * 60 * min + 7 * min,
      exitCode: 0,
      branch: 'agent/security-sweep',
    },
  ]

  const dir = join(configDir, 'cron-runs')
  mkdirSync(dir, { recursive: true })
  runs.forEach((r, i) => {
    const id = `demo-run-${i + 1}`
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify(
        {
          id,
          scheduleId: `demo-sched-${i + 1}`,
          repoLabel,
          worktree: join(repoRoot, '..', `${repoLabel}-${r.agentId}`),
          ...r,
        },
        null,
        2,
      ),
    )
  })

  const schedules = [
    {
      id: 'demo-sched-1',
      agentId: 'strengthen-tests',
      agentTitle: 'Strengthen tests',
      engine: 'claude',
      spec: { kind: 'calendar', minute: 0, hour: 3 },
      enabled: true,
      lastStatus: 'done',
    },
    {
      id: 'demo-sched-2',
      agentId: 'improve-docs',
      agentTitle: 'Improve docs',
      engine: 'codex',
      spec: { kind: 'calendar', minute: 30, hour: 6 },
      enabled: true,
      lastStatus: 'done',
    },
    {
      id: 'demo-sched-3',
      agentId: 'dependency-hygiene',
      agentTitle: 'Dependency hygiene',
      engine: 'claude',
      spec: { kind: 'calendar', minute: 0, hour: 9, weekday: 1 },
      enabled: false,
      lastStatus: 'failed',
    },
  ].map((s) => ({
    ...s,
    repoRoot,
    repoLabel,
    prompt: 'Seeded for the README capture.',
    createdAt: now - 7 * 24 * 60 * min,
  }))
  writeFileSync(join(configDir, 'schedules.json'), JSON.stringify(schedules, null, 2))
}
