import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type PromptSnippet = {
  id: string
  title: string
  prompt: string
  description?: string
  group?: string
}

type SnippetFile = {
  version?: number
  snippets?: unknown
}

const CFG = join(homedir(), '.config', 'TerMinal')
const GLOBAL_FILE = join(CFG, 'snippets.json')
const REPO_FILE = '.TerMinal/snippets.json'
const LEGACY_REPO_FILE = '.terminal/snippets.json'
const SNIPPET_SCHEMA_VERSION = 2

const BUILT_INS: PromptSnippet[] = [
  { id: 'continue', title: 'Looks good. Continue', prompt: 'Looks good to me. Continue.', group: 'Common' },
  { id: 'status', title: 'Status', prompt: 'Give me a concise status update: what changed, what is left, and whether anything is blocked.', group: 'Common' },
  { id: 'wrap-up', title: 'Wrap up', prompt: 'Finish the current task, run the relevant checks, commit if appropriate, and summarize the result.', group: 'Common' },
  { id: 'pause-summary', title: 'Pause Summary', prompt: 'Pause here and summarize the current state, including changed files, decisions made, and exact next steps.', group: 'Common' },
  { id: 'be-concise', title: 'Be Concise', prompt: 'Keep the next response concise and action-oriented. Avoid extra explanation unless it changes the decision.', group: 'Common' },
  { id: 'tests', title: 'Run Test Suite', prompt: 'Run the relevant test suite for this repo, fix failures caused by the current work, and report the final result.', group: 'Checks' },
  { id: 'typecheck', title: 'Typecheck', prompt: 'Run the project typecheck. Fix type errors caused by the current work, then report the result.', group: 'Checks' },
  { id: 'lint', title: 'Lint', prompt: 'Run the project lint/format checks. Fix issues caused by the current work, then report the result.', group: 'Checks' },
  { id: 'build', title: 'Build', prompt: 'Run the project build. Fix build failures caused by the current work, then report the result.', group: 'Checks' },
  { id: 'full-verify', title: 'Full Verify', prompt: "Run typecheck, tests, and build using this repo's standard commands. Fix current-work failures and summarize the final status.", group: 'Checks' },
  { id: 'smoke-test', title: 'Smoke Test', prompt: 'Run a focused smoke test of the changed workflow or UI. Verify the user-facing behavior, then summarize what passed.', group: 'Checks' },
  { id: 'inspect-diff', title: 'Inspect Diff', prompt: 'Review the current git diff carefully for bugs, unintended changes, missing tests, and style mismatches. Fix anything real.', group: 'Review' },
  { id: 'self-review', title: 'Self Review', prompt: 'Do a senior-engineer self-review of your changes. Prioritize correctness, edge cases, regressions, and missing verification.', group: 'Review' },
  { id: 'security-review', title: 'Security Review', prompt: 'Review the current changes for security issues: unsafe input handling, command execution, path traversal, secrets, auth, and dependency risk.', group: 'Review' },
  { id: 'perf-review', title: 'Performance Review', prompt: 'Review the current changes for avoidable performance issues, unnecessary polling, blocking work, memory leaks, or expensive re-renders.', group: 'Review' },
  { id: 'ux-polish', title: 'UX Polish Pass', prompt: 'Do a focused UX polish pass on the changed interface: spacing, labels, empty states, keyboard/mouse behavior, and responsive fit.', group: 'Review' },
  { id: 'commit', title: 'Commit', prompt: 'Review the diff, run the relevant checks, then commit the completed work with a clear conventional commit message.', group: 'Git' },
  { id: 'commit-push', title: 'Commit + Push', prompt: 'Review the diff, run the relevant checks, commit the completed work, and push it to the tracked branch.', group: 'Git' },
  { id: 'git-status', title: 'Git Status', prompt: 'Show me the current git status and summarize which changes are yours, which are pre-existing, and what remains uncommitted.', group: 'Git' },
  { id: 'prep-pr', title: 'Prepare PR', prompt: 'Prepare this branch for PR: verify checks, summarize changes, note tests run, and identify any risk or follow-up.', group: 'Git' },
  { id: 'open-pr', title: 'Open PR', prompt: 'If the branch is ready, open a PR/MR with a concise summary, tests run, and linked tickets. Do not merge it.', group: 'Git' },
  { id: 'implement-ticket', title: 'Implement Ticket', prompt: 'Implement the selected/open backlog ticket end to end. Keep changes surgical, add tests, commit, and open a PR linking the ticket.', group: 'Tickets' },
  { id: 'file-ticket', title: 'File Ticket', prompt: 'File a precise backlog ticket for the issue or follow-up we just discussed. Include context, acceptance criteria, priority, and type.', group: 'Tickets' },
  { id: 'close-ticket', title: 'Close Ticket', prompt: 'If the current work fully satisfies the related ticket, update the ticket status to closed and link the PR/commit. Otherwise mark it in-progress with a note.', group: 'Tickets' },
  { id: 'split-ticket', title: 'Split Ticket', prompt: 'If this ticket is too broad, split the remaining work into focused backlog tickets and summarize what stays in scope now.', group: 'Tickets' },
  { id: 'find-next-ticket', title: 'Find Next Ticket', prompt: 'Inspect the backlog and recommend the next highest-leverage ticket to work on, with rationale and risks.', group: 'Tickets' },
  { id: 'write-docs', title: 'Update Docs', prompt: 'Update any docs affected by the current changes. Keep docs accurate and concise; do not invent behavior.', group: 'Docs' },
  { id: 'write-adr', title: 'Capture Decision', prompt: 'If this change made a non-obvious architectural decision, write or update an ADR. Otherwise say no ADR is needed.', group: 'Docs' },
  { id: 'write-runbook', title: 'Write Runbook', prompt: 'If the current workflow involves repeatable manual operations, add or update a runbook with exact steps and verification.', group: 'Docs' },
  { id: 'docs-audit', title: 'Docs Audit', prompt: 'Check whether the docs now contradict the implementation or miss important changed behavior. Fix only directly related docs.', group: 'Docs' },
  { id: 'debug-failure', title: 'Debug Failure', prompt: 'Diagnose the latest failure from logs or test output. Identify the root cause, apply a focused fix, and rerun the failing check.', group: 'Debug' },
  { id: 'explain-error', title: 'Explain Error', prompt: 'Explain the current error in plain terms, identify the likely root cause, and propose the smallest safe fix.', group: 'Debug' },
  { id: 'add-logging', title: 'Add Diagnostics', prompt: 'Add minimal diagnostics to understand the failing path, run the reproduction, then remove noisy diagnostics before finishing.', group: 'Debug' },
  { id: 'reproduce-bug', title: 'Reproduce Bug', prompt: 'Create or run a focused reproduction for the bug before fixing it. Confirm the failure, fix it, then confirm it passes.', group: 'Debug' },
  { id: 'simplify', title: 'Simplify', prompt: 'Look for unnecessary complexity in the current changes. Simplify where it preserves behavior and improves maintainability.', group: 'Refactor' },
  { id: 'remove-dead-code', title: 'Remove Dead Code', prompt: 'Find dead code introduced or exposed by the current work. Remove only what is provably unused and verify checks still pass.', group: 'Refactor' },
  { id: 'tighten-types', title: 'Tighten Types', prompt: 'Tighten the types around the changed code without broad refactors. Avoid adding abstractions unless they remove real risk.', group: 'Refactor' },
  { id: 'add-tests', title: 'Add Tests', prompt: 'Add focused tests for the changed behavior and important edge cases. Avoid implementation-mirroring assertions.', group: 'Tests' },
  { id: 'test-first', title: 'Test First', prompt: 'Before changing code further, write a failing test that captures the desired behavior or bug, verify it fails, then implement the fix.', group: 'Tests' },
  { id: 'edge-cases', title: 'Cover Edge Cases', prompt: 'Identify important edge cases for the current change and add focused coverage for the ones likely to regress.', group: 'Tests' },
  { id: 'update-snapshots', title: 'Update Snapshots', prompt: 'If snapshot or golden output changes are expected, inspect the diff carefully, update snapshots, and explain why the changes are correct.', group: 'Tests' },
  { id: 'resume-context', title: 'Restore Context', prompt: 'Read the relevant local files and recent git diff, then restate the goal, current state, and next action before continuing.', group: 'Context' },
  { id: 'handoff', title: 'Handoff Note', prompt: 'Write a concise handoff note: goal, completed work, pending work, files changed, checks run, and any blockers.', group: 'Context' },
  { id: 'risk-list', title: 'Risk List', prompt: 'List the main risks in the current approach, ordered by severity, and recommend concrete mitigations.', group: 'Context' },
  { id: 'decision-check', title: 'Decision Check', prompt: 'Before proceeding, state the key implementation decision, alternatives considered, and why this path fits the existing codebase.', group: 'Context' },
]

function parseSnippetList(raw: unknown): PromptSnippet[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      id: String(x.id || '').trim(),
      title: String(x.title || '').trim(),
      prompt: String(x.prompt || '').trim(),
      description: typeof x.description === 'string' ? x.description : undefined,
      group: typeof x.group === 'string' ? x.group : undefined,
    }))
    .filter((x) => x.id && x.title && x.prompt)
}

const sameSnippet = (a: PromptSnippet, b: PromptSnippet) =>
  a.id === b.id &&
  a.title === b.title &&
  a.prompt === b.prompt &&
  (a.description || '') === (b.description || '') &&
  (a.group || '') === (b.group || '')

export function migrateSnippetFile(raw: SnippetFile): { version: number; snippets: PromptSnippet[] } {
  const builtInsById = new Map(BUILT_INS.map((s) => [s.id, s]))
  const snippets = parseSnippetList(raw.snippets).filter((s) => {
    const builtIn = builtInsById.get(s.id)
    return !builtIn || !sameSnippet(s, builtIn)
  })
  return { version: SNIPPET_SCHEMA_VERSION, snippets }
}

function readSnippetFile(path: string): PromptSnippet[] {
  try {
    if (!existsSync(path)) return []
    const json = JSON.parse(readFileSync(path, 'utf8')) as SnippetFile
    return parseSnippetList(json.snippets)
  } catch {
    return []
  }
}

function ensureGlobalFile(): void {
  mkdirSync(CFG, { recursive: true })
  if (!existsSync(GLOBAL_FILE)) {
    writeFileSync(
      GLOBAL_FILE,
      JSON.stringify({ version: SNIPPET_SCHEMA_VERSION, snippets: [] }, null, 2),
    )
    return
  }
  try {
    const raw = JSON.parse(readFileSync(GLOBAL_FILE, 'utf8')) as SnippetFile
    if (raw.version === SNIPPET_SCHEMA_VERSION) return
    writeFileSync(
      GLOBAL_FILE,
      JSON.stringify({ ...raw, ...migrateSnippetFile(raw) }, null, 2),
    )
  } catch {
    /* unreadable user file: leave it untouched and fall back to built-ins at runtime */
  }
}

function snippetFile(path: string): SnippetFile {
  try {
    if (!existsSync(path)) return { version: SNIPPET_SCHEMA_VERSION, snippets: [] }
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SnippetFile
    return {
      ...parsed,
      version: SNIPPET_SCHEMA_VERSION,
      snippets: Array.isArray(parsed.snippets) ? parsed.snippets : [],
    }
  } catch {
    return { version: SNIPPET_SCHEMA_VERSION, snippets: [] }
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function savePromptSnippet(input: {
  scope: 'global' | 'repo'
  repoRoot?: string
  snippet: Partial<PromptSnippet>
}): { ok: true; path: string; snippet: PromptSnippet } | { error: string } {
  const title = String(input.snippet.title || '').trim()
  const prompt = String(input.snippet.prompt || '').trim()
  if (!title) return { error: 'title is required' }
  if (!prompt) return { error: 'prompt is required' }
  const id = slug(String(input.snippet.id || title))
  if (!id) return { error: 'id is required' }
  const path = input.scope === 'global' ? GLOBAL_FILE : input.repoRoot ? join(input.repoRoot, REPO_FILE) : ''
  if (!path) return { error: 'repo root is required' }
  mkdirSync(input.scope === 'global' ? CFG : join(input.repoRoot!, '.TerMinal'), { recursive: true })
  const file = snippetFile(path)
  const snippets = readSnippetFile(path).filter((s) => s.id !== id)
  const snippet: PromptSnippet = {
    id,
    title,
    prompt,
    description: input.snippet.description?.trim() || undefined,
    group: input.snippet.group?.trim() || 'Custom',
  }
  writeFileSync(
    path,
    JSON.stringify(
      { ...file, version: SNIPPET_SCHEMA_VERSION, snippets: [...snippets, snippet] },
      null,
      2,
    ),
  )
  return { ok: true, path, snippet }
}

export function listPromptSnippets(repoRoot: string): {
  snippets: PromptSnippet[]
  globalPath: string
  repoPath: string
} {
  ensureGlobalFile()
  const repoPath = repoRoot ? join(repoRoot, REPO_FILE) : ''
  const legacyRepoPath = repoRoot ? join(repoRoot, LEGACY_REPO_FILE) : ''
  const byId = new Map<string, PromptSnippet>()
  for (const s of BUILT_INS) byId.set(s.id, s)
  for (const s of readSnippetFile(GLOBAL_FILE)) byId.set(s.id, s)
  for (const s of legacyRepoPath ? readSnippetFile(legacyRepoPath) : []) byId.set(s.id, s)
  for (const s of repoPath ? readSnippetFile(repoPath) : []) byId.set(s.id, s)
  return { snippets: [...byId.values()], globalPath: GLOBAL_FILE, repoPath }
}
