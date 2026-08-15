import { describe, expect, test } from 'bun:test'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const CLI = join(process.cwd(), 'bin', 'terminal-cli')
const MCP_SERVER = join(process.cwd(), 'bin', 'terminal-mcp-server')

// Every case gets a fresh HOME so nothing ever touches the real
// ~/.config/TerMinal, plus a temp repo (inside its own projects dir, so the
// MCP server's projectsDir scan only ever sees this repo) and a temp vault.
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'terminal-cli-ticket-home-'))
  const projects = mkdtempSync(join(tmpdir(), 'terminal-cli-ticket-projects-'))
  const repo = mkdtempSync(join(projects, 'repo-'))
  const vault = mkdtempSync(join(tmpdir(), 'terminal-cli-ticket-vault-'))
  return { home, repo, vault }
}

function writeTicketsConfig(repo: string, config: unknown) {
  mkdirSync(join(repo, '.TerMinal'), { recursive: true })
  writeFileSync(join(repo, '.TerMinal', 'tickets.json'), JSON.stringify(config))
}

function runCli(args: string[], home: string, repo: string) {
  return spawnSync('bun', [CLI, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      TERMINAL_CONFIG_DIR: join(home, '.config', 'TerMinal'),
      TERMINAL_REPO_STATE_DIR: join(home, '.config', 'TerMinal', 'repos'),
      TERMINAL_REPO: repo,
      TERMINAL_AGENT_ID: 'test-agent',
    },
    encoding: 'utf8' as const,
  })
}

// The `terminal-cli mcp <tool>` wrapper spawns the *installed* server from
// $HOME/.config/TerMinal/bin — install our checkout's copy into the temp HOME.
// Also point settings.projectsDir at the repo's parent (with a .git marker) so
// the server's repo resolver can find the temp repo by basename.
function installMcpWrapper(home: string, repo: string) {
  const cfgDir = join(home, '.config', 'TerMinal')
  const bin = join(cfgDir, 'bin')
  mkdirSync(bin, { recursive: true })
  const dest = join(bin, 'terminal-mcp-server')
  copyFileSync(MCP_SERVER, dest)
  chmodSync(dest, 0o755)
  writeFileSync(join(cfgDir, 'settings.json'), JSON.stringify({ projectsDir: join(repo, '..') }))
  mkdirSync(join(repo, '.git'), { recursive: true })
}

// Every plausible repo-local ticket location — none of these may receive NEW
// tickets now that state lives in the sidecar.
function repoBacklogFiles(repo: string): string[] {
  const out: string[] = []
  for (const dir of [join(repo, 'backlog'), join(repo, '.TerMinal', 'backlog')]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) out.push(join(dir, f))
  }
  return out
}

/** Ticket files in the per-project sidecar under a test's fake HOME. */
function sidecarBacklogFiles(home: string): string[] {
  const root = join(home, '.config', 'TerMinal', 'repos')
  const out: string[] = []
  const walk = (dir: string) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.md')) out.push(p)
    }
  }
  walk(root)
  return out
}

describe('terminal-cli ticket — provider routing', () => {
  // The obsidian provider was retired. A repo whose saved config still names it
  // must degrade to the sidecar backlog rather than fail — and must never write
  // into the user's old vault folder.
  test('a retired obsidian config degrades to the sidecar backlog, vault untouched', () => {
    const { home, repo, vault } = setup()
    writeTicketsConfig(repo, { provider: 'obsidian', obsidian: { vaultPath: vault } })
    mkdirSync(join(vault, 'tickets'), { recursive: true })

    const result = runCli(['ticket', 'Degraded ticket', 'body text'], home, repo)

    expect(result.status).toBe(0)
    const printed = result.stdout.trim()
    expect(printed).toEndWith(join('backlog', '0001-degraded-ticket.md'))
    expect(sidecarBacklogFiles(home)).toEqual([printed])
    expect(repoBacklogFiles(repo)).toEqual([])
    expect(readdirSync(join(vault, 'tickets'))).toEqual([])
  })

  test('no ticket provider config writes to the sidecar, never the repo', () => {
    const { home, repo } = setup()

    const result = runCli(['ticket', 'Local fallback', 'b'], home, repo)

    expect(result.status).toBe(0)
    const printed = result.stdout.trim()
    expect(existsSync(printed)).toBe(true)
    // The whole point: a repo shared with collaborators receives nothing.
    expect(repoBacklogFiles(repo)).toEqual([])
    expect(sidecarBacklogFiles(home)).toEqual([printed])
    expect(printed).toEndWith(join('backlog', '0001-local-fallback.md'))
  })

  test('commenting still finds a ticket that predates the sidecar', () => {
    const { home, repo } = setup()
    // A repo mid-migration: the ticket is still committed in-repo.
    mkdirSync(join(repo, '.TerMinal', 'backlog'), { recursive: true })
    writeFileSync(
      join(repo, '.TerMinal', 'backlog', '0042-legacy.md'),
      '---\nid: 42\ntitle: "Legacy"\nstatus: open\n---\n\nbody\n',
    )

    const r = runCli(['ticket', 'comment', '0042-legacy', 'a note'], home, repo)

    expect(r.status).toBe(0)
    expect(readFileSync(join(repo, '.TerMinal', 'backlog', '0042-legacy.md'), 'utf8')).toContain(
      'a note',
    )
  })
})

// The `terminal-cli mcp <tool>` passthrough is a separate entry point from
// `terminal-cli ticket` — it spawns the installed MCP server — so it needs its
// own proof that ticket tools resolve the same store.
describe('terminal-cli mcp — ticket tools', () => {
  test('file_ticket and list_tickets go through the sidecar backlog', () => {
    const { home, repo } = setup()
    installMcpWrapper(home, repo)
    const repoName = repo.split('/').pop()!

    const filed = runCli(
      ['mcp', 'file_ticket', `repo=${repoName}`, 'title="Wrapper filed"', 'type=testing'],
      home,
      repo,
    )
    expect(filed.status).toBe(0)
    const path = JSON.parse(filed.stdout).path
    expect(existsSync(path)).toBe(true)
    expect(sidecarBacklogFiles(home)).toEqual([path])
    expect(repoBacklogFiles(repo)).toEqual([])

    const listed = runCli(['mcp', 'list_tickets', `repo=${repoName}`], home, repo)
    expect(listed.status).toBe(0)
    expect(JSON.parse(listed.stdout).map((t: { slug: string }) => t.slug)).toEqual([
      '0001-wrapper-filed',
    ])
  })
})

describe('terminal-cli ticket comment', () => {
  const seedLocalTicket = (repo: string) => {
    const backlog = join(repo, '.TerMinal', 'backlog')
    mkdirSync(backlog, { recursive: true })
    writeFileSync(
      join(backlog, '0001-seed.md'),
      [
        '---',
        'id: 1',
        'title: "Seed"',
        'status: open',
        'priority: medium',
        '---',
        '',
        'prose',
      ].join('\n'),
    )
    return join(backlog, '0001-seed.md')
  }

  test('an agent comment is attributed to TERMINAL_AGENT_ID and appended to the log', () => {
    const { home, repo } = setup()
    const path = seedLocalTicket(repo)
    const r = runCli(
      ['ticket', 'comment', '0001-seed', 'acceptance #2 fails on empty input'],
      home,
      repo,
    )
    expect(r.status).toBe(0)

    const md = readFileSync(path, 'utf8')
    expect(md).toContain('## Log')
    expect(md).toContain('· agent:test-agent')
    expect(md).toContain('acceptance #2 fails on empty input')
    // Prose must be preserved above the log, not replaced by it.
    expect(md.indexOf('prose')).toBeLessThan(md.indexOf('## Log'))
  })

  test('a second comment appends instead of overwriting the first', () => {
    const { home, repo } = setup()
    const path = seedLocalTicket(repo)
    runCli(['ticket', 'comment', '0001-seed', 'first'], home, repo)
    runCli(['ticket', 'comment', '0001-seed', 'second'], home, repo)

    const md = readFileSync(path, 'utf8')
    expect(md).toContain('first')
    expect(md).toContain('second')
    expect(md.match(/^## Log$/gm)?.length).toBe(1)
    expect(md.indexOf('first')).toBeLessThan(md.indexOf('second'))
  })

  test('an unknown slug exits non-zero rather than silently succeeding', () => {
    const { home, repo } = setup()
    seedLocalTicket(repo)
    const r = runCli(['ticket', 'comment', '9999-nope', 'x'], home, repo)
    expect(r.status).not.toBe(0)
  })

  test('an empty body exits non-zero rather than writing a blank entry', () => {
    const { home, repo } = setup()
    const path = seedLocalTicket(repo)
    const r = runCli(['ticket', 'comment', '0001-seed', '   '], home, repo)
    expect(r.status).not.toBe(0)
    expect(readFileSync(path, 'utf8')).not.toContain('## Log')
  })
})
