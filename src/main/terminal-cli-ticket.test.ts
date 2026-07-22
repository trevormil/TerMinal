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
    env: { ...process.env, HOME: home, TERMINAL_REPO: repo, TERMINAL_AGENT_ID: 'test-agent' },
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
// when the repo routes tickets to an Obsidian vault.
function repoBacklogFiles(repo: string): string[] {
  const out: string[] = []
  for (const dir of [join(repo, 'backlog'), join(repo, '.TerMinal', 'backlog')]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) out.push(join(dir, f))
  }
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

  test('no ticket provider config falls back to the repo backlog', () => {
    const { home, repo } = setup()

    const result = runCli(['ticket', 'Local fallback', 'b'], home, repo)

    expect(result.status).toBe(0)
    const printed = result.stdout.trim()
    expect(printed).toBe(join(repo, 'backlog', '0001-local-fallback.md'))
    expect(existsSync(printed)).toBe(true)
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

    const files = repoBacklogFiles(repo).map((f) => readFileSync(f, 'utf8'))
    expect(files.find((f) => f.includes('Default tier'))).toContain('model_tier: auto')
    expect(files.find((f) => f.includes('Cheap tier'))).toContain('model_tier: cheap-raw')
    // An unroutable tier must not persist — it would bill at the default slot.
    expect(files.find((f) => f.includes('Typo tier'))).toContain('model_tier: auto')
    expect(files.join('')).not.toContain('cheep-raw')
  })
})
