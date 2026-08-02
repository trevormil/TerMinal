// Builds the throwaway git repo the UX suite attaches a session to.
//
// It is deliberately "fully provisioned": a git repo with a forge remote, a
// backlog, agents, and a repo-sourced widget. Tabs gate themselves on those
// (`appliesTo(ctx)`), so a thin fixture would silently shrink the surface the
// suite covers — the tab that fails to render is exactly the one that would not
// have appeared.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const git = (repo: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd: repo,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'UX Suite',
      GIT_AUTHOR_EMAIL: 'ux@example.invalid',
      GIT_COMMITTER_NAME: 'UX Suite',
      GIT_COMMITTER_EMAIL: 'ux@example.invalid',
    },
  })

const ticket = (id: number, title: string, status: string, extra = '') => `---
id: ${id}
title: "${title}"
status: ${status}
priority: high
horizon: now
type: feature
source: ux-suite
created: 2026-07-01
updated: 2026-07-01
prs: []
refs: []
depends_on: []
agent_id: ux-fixture-agent
agent_scope: repo
agent_kind: classic
---

Fixture ticket body for the UX suite. ${extra}

## Detail

A paragraph long enough that the detail pane has something to lay out.
`

export function buildFixtureRepo(repo: string): void {
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  // A forge remote so the MRs/CI tabs apply and render their real "no results"
  // state rather than the "this repo has no forge remote" bail-out.
  // Overridable for README capture, where the slug is VISIBLE in the run/PR
  // filters and `ux-suite/fixture` reads as test scaffolding rather than a
  // product. Tests keep the default.
  const slug = process.env.TERMINAL_UX_REMOTE_SLUG || 'ux-suite/fixture'
  git(repo, 'remote', 'add', 'origin', `https://github.com/${slug}.git`)

  // Bootstrap markers. `bootstrapStatus` (src/main/remote.ts) looks for six:
  // .agents, backlog, docs, sessions, .claude/skills, .codex/skills. With any
  // missing, every screen carries a yellow "This repo is partially bootstrapped"
  // banner — which is honest but wrong for a fixture that is supposed to
  // represent a fully-provisioned repo, and it dominates the README shots.
  for (const dir of ['docs', 'sessions', '.claude/skills', '.codex/skills']) {
    mkdirSync(join(repo, dir), { recursive: true })
    writeFileSync(join(repo, dir, '.gitkeep'), '')
  }
  writeFileSync(join(repo, 'README.md'), '# fixture\n\nUX suite fixture repo.\n')
  writeFileSync(join(repo, 'CLAUDE.md'), '# CLAUDE.md\n\nFixture repo instructions.\n')

  const tm = join(repo, '.TerMinal')
  mkdirSync(join(tm, 'backlog'), { recursive: true })
  writeFileSync(
    join(tm, 'backlog', '0001-fixture-open.md'),
    ticket(1, 'Fixture open ticket', 'open'),
  )
  writeFileSync(
    join(tm, 'backlog', '0002-fixture-closed.md'),
    ticket(2, 'Fixture closed ticket', 'closed'),
  )

  // A repo-sourced widget makes the trust prompt pending, which is what the
  // Plugins-drawer test asserts on. The command is inert (never approved) and
  // harmless if it ever ran.
  writeFileSync(
    join(tm, 'widgets.json'),
    JSON.stringify(
      [
        {
          id: 'fixture-echo',
          title: 'Fixture echo',
          command: 'echo ux-suite-fixture-widget',
          intervalMs: 600000,
          mode: 'text',
        },
      ],
      null,
      2,
    ),
  )

  const agents = join(repo, '.agents')
  mkdirSync(agents, { recursive: true })
  writeFileSync(
    join(agents, 'agents.json'),
    JSON.stringify(
      [{ id: 'ux-fixture-agent', title: 'UX fixture agent', prompt: 'Do nothing.' }],
      null,
      2,
    ),
  )

  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'fixture')
}

/** The literal command string the trust prompt must show verbatim. */
export const FIXTURE_WIDGET_COMMAND = 'widget: echo ux-suite-fixture-widget'
