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

// Every plausible repo-local ticket location — none of these may be written to
// when the repo routes tickets to an Obsidian vault, and none of them may
// receive NEW tickets at all now that state lives in the sidecar.
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

describe('terminal-cli ticket — obsidian provider routing', () => {
  test('files the ticket into the configured vault, never the repo backlog', () => {
    const { home, repo, vault } = setup()
    writeTicketsConfig(repo, { provider: 'obsidian', obsidian: { vaultPath: vault } })
    // Adversarial decoy: a pre-existing repo backlog. If routing fell back to
    // the repo, the new ticket would land here (as 0008) instead of the vault.
    mkdirSync(join(repo, 'backlog'), { recursive: true })
    writeFileSync(join(repo, 'backlog', '0007-decoy.md'), '---\nid: 7\n---\n')

    const result = runCli(['ticket', 'Vault routed ticket', 'body text'], home, repo)

    expect(result.status).toBe(0)
    const printed = result.stdout.trim()
    expect(printed).toBe(join(vault, 'tickets', '0001-vault-routed-ticket.md'))
    const raw = readFileSync(printed, 'utf8')
    expect(raw).toContain('title: "Vault routed ticket"')
    expect(raw).toContain('body text')
    // Repo backlog untouched: still exactly the decoy, nothing new anywhere.
    expect(repoBacklogFiles(repo)).toEqual([join(repo, 'backlog', '0007-decoy.md')])
  })

  test('honors a custom ticketsSubdir', () => {
    const { home, repo, vault } = setup()
    writeTicketsConfig(repo, {
      provider: 'obsidian',
      obsidian: { vaultPath: vault, ticketsSubdir: 'issues' },
    })

    const result = runCli(['ticket', 'Subdir ticket', ''], home, repo)

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(join(vault, 'issues', '0001-subdir-ticket.md'))
    expect(existsSync(join(vault, 'tickets'))).toBe(false)
    expect(repoBacklogFiles(repo)).toEqual([])
  })

  test('provider obsidian without a vault path fails clearly and writes nothing locally', () => {
    const { home, repo } = setup()
    writeTicketsConfig(repo, { provider: 'obsidian' })
    mkdirSync(join(repo, 'backlog'), { recursive: true })
    writeFileSync(join(repo, 'backlog', '0007-decoy.md'), '---\nid: 7\n---\n')

    const result = runCli(['ticket', 'Should not land anywhere', 'b'], home, repo)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/obsidian/i)
    expect(result.stderr).toMatch(/vault/i)
    // No fallback write into the repo backlog — the decoy is still alone.
    expect(repoBacklogFiles(repo)).toEqual([join(repo, 'backlog', '0007-decoy.md')])
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

describe('terminal-cli mcp — ticket tools route to the obsidian vault', () => {
  test('list_tickets and update_ticket read/write the vault, not the repo backlog', () => {
    const { home, repo, vault } = setup()
    writeTicketsConfig(repo, { provider: 'obsidian', obsidian: { vaultPath: vault } })
    installMcpWrapper(home, repo)
    const repoName = repo.split('/').pop()!
    // One real ticket in the vault; one decoy in the repo backlog that must
    // never surface once the repo is on the obsidian provider.
    mkdirSync(join(vault, 'tickets'), { recursive: true })
    writeFileSync(
      join(vault, 'tickets', '0001-vault-ticket.md'),
      '---\nid: 1\ntitle: "Vault ticket"\nstatus: open\npriority: medium\ntype: testing\nprs: []\n---\n\nbody\n',
    )
    mkdirSync(join(repo, 'backlog'), { recursive: true })
    writeFileSync(
      join(repo, 'backlog', '0002-repo-decoy.md'),
      '---\nid: 2\ntitle: "Repo decoy"\nstatus: open\n---\n',
    )

    const listed = runCli(['mcp', 'list_tickets', `repo=${repoName}`], home, repo)
    expect(listed.status).toBe(0)
    const tickets = JSON.parse(listed.stdout)
    expect(tickets.map((t: { slug: string }) => t.slug)).toEqual(['0001-vault-ticket'])

    const updated = runCli(
      ['mcp', 'update_ticket', 'slug=0001-vault-ticket', 'status=closed'],
      home,
      repo,
    )
    expect(updated.status).toBe(0)
    expect(readFileSync(join(vault, 'tickets', '0001-vault-ticket.md'), 'utf8')).toContain(
      'status: closed',
    )
    // The decoy in the repo backlog was neither listed nor touched.
    expect(readFileSync(join(repo, 'backlog', '0002-repo-decoy.md'), 'utf8')).toContain(
      'status: open',
    )
  })

  test('file_ticket via the wrapper lands in the vault', () => {
    const { home, repo, vault } = setup()
    writeTicketsConfig(repo, { provider: 'obsidian', obsidian: { vaultPath: vault } })
    installMcpWrapper(home, repo)
    const repoName = repo.split('/').pop()!

    const result = runCli(
      ['mcp', 'file_ticket', `repo=${repoName}`, 'title="Wrapper filed"', 'type=testing'],
      home,
      repo,
    )

    expect(result.status).toBe(0)
    const filed = JSON.parse(result.stdout)
    expect(filed.path).toBe(join(vault, 'tickets', '0001-wrapper-filed.md'))
    expect(existsSync(filed.path)).toBe(true)
    expect(repoBacklogFiles(repo)).toEqual([])
  })

  test('writes a model_tier line, honoring an explicit tier and rejecting junk', () => {
    // The third ticket writer: without this line its frontmatter disagreed with
    // backlog.ts and the MCP server, and a script could never pick a tier.
    const { home, repo } = setup()
    runCli(['ticket', 'Default tier', 'body'], home, repo)
    runCli(['ticket', 'Cheap tier', 'body', 'cheap-raw'], home, repo)
    runCli(['ticket', 'Typo tier', 'body', 'cheep-raw'], home, repo)

    const files = sidecarBacklogFiles(home).map((f) => readFileSync(f, 'utf8'))
    expect(files.find((f) => f.includes('Default tier'))).toContain('model_tier: auto')
    expect(files.find((f) => f.includes('Cheap tier'))).toContain('model_tier: cheap-raw')
    // An unroutable tier must not persist — it would bill at the default slot.
    expect(files.find((f) => f.includes('Typo tier'))).toContain('model_tier: auto')
    expect(files.join('')).not.toContain('cheep-raw')
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

  test('an Obsidian repo comments into the vault, never the repo backlog', () => {
    const { home, repo, vault } = setup()
    writeTicketsConfig(repo, { provider: 'obsidian', obsidian: { vaultPath: vault } })
    const tickets = join(vault, 'tickets')
    mkdirSync(tickets, { recursive: true })
    writeFileSync(
      join(tickets, '0001-seed.md'),
      ['---', 'id: 1', 'title: "Seed"', 'status: open', '---', '', 'prose'].join('\n'),
    )
    const r = runCli(['ticket', 'comment', '0001-seed', 'from the vault'], home, repo)
    expect(r.status).toBe(0)
    expect(readFileSync(join(tickets, '0001-seed.md'), 'utf8')).toContain('from the vault')
    expect(existsSync(join(repo, '.TerMinal', 'backlog', '0001-seed.md'))).toBe(false)
  })
})
