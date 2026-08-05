import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REMOTE_SCRIPT } from './remote'

// remote-host-script.cjs runs on the remote workstation, where scheduled
// agents file tickets. It resolved areas repo-relative only, so every ticket
// created there landed in the checkout — the exact thing the sidecar exists to
// prevent, in the one place nobody looks. Parity tests pin its BYTES against
// the canonical block; this pins its BEHAVIOUR by actually running it.

let base: string
let repo: string
let stateDir: string

// Run it the way SSH does — `node -e <script> <payload>` — so this covers the
// real shipped path rather than a reimplementation of it.
function run(input: Record<string, unknown>): unknown {
  const stdout = execFileSync('node', ['-e', REMOTE_SCRIPT, JSON.stringify(input)], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, TERMINAL_REPO_STATE_DIR: stateDir },
  })
  return JSON.parse(stdout)
}

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'tm-remote-state-')))
  repo = join(base, 'repo')
  stateDir = join(base, 'state')
  mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repo })
  // An origin makes the sidecar key stable and host/owner/repo-shaped, which is
  // the normal case on a remote host.
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/widget.git'], { cwd: repo })
  // A repo that still carries v1 state: the migration is gradual, so this is
  // the shape most repos are in when they first reach a remote host.
  mkdirSync(join(repo, 'backlog'), { recursive: true })
  writeFileSync(
    join(repo, 'backlog', '0007-existing.md'),
    ['---', 'id: 7', 'title: "Already here"', 'status: open', '---', '', 'body', ''].join('\n'),
  )
})

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true })
})

describe('remote host script resolves workflow state through the sidecar', () => {
  test('reads merge, so pre-migration tickets are still visible', () => {
    const tickets = run({ op: 'tickets.list' }) as { id: number; title: string }[]
    expect(tickets.map((t) => t.id)).toContain(7)
  })

  test('a ticket created on the remote host is written to the sidecar, not the repo', () => {
    run({ op: 'tickets.create', ticket: { title: 'Filed from the remote host' } })

    const sidecar = join(stateDir, 'github.com/acme/widget/backlog')
    const inSidecar = existsSync(sidecar) ? readdirSync(sidecar) : []
    expect(inSidecar.some((f) => f.endsWith('-filed-from-the-remote-host.md'))).toBe(true)

    // The repo must be untouched — a collaborator pulling this checkout gets
    // nothing new.
    const inRepo = readdirSync(join(repo, 'backlog'))
    expect(inRepo).toEqual(['0007-existing.md'])
  })

  test('ids continue past state that has not migrated yet', () => {
    // Allocating from an empty sidecar while the repo still holds 0007 would
    // hand out 0001 again and shadow it.
    const tickets = run({ op: 'tickets.list' }) as { id: number }[]
    const created = tickets.find((t) => t.id !== 7)
    expect(created?.id).toBe(8)
  })

  test('the created ticket reports the path it actually lives at', () => {
    const found = run({ op: 'workspace.search', q: 'remote host', kinds: ['ticket'] }) as
      | { results?: { kind: string; path: string }[] }
      | { kind: string; path: string }[]
    const results = Array.isArray(found) ? found : found.results || []
    const hit = results.find((r) => r.kind === 'ticket' && /filed-from-the-remote-host/.test(r.path))
    expect(hit).toBeDefined()
    expect(hit!.path.startsWith(stateDir)).toBe(true)
  })
})
