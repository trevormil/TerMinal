import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SERVER = join(process.cwd(), 'bin', 'terminal-mcp-server')

// Fresh HOME per case (never touches the real ~/.config/TerMinal) + a temp
// projects dir the server discovers repos in + a temp repo + a temp vault.
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'terminal-mcp-home-'))
  const projects = mkdtempSync(join(tmpdir(), 'terminal-mcp-projects-'))
  const repo = mkdtempSync(join(projects, 'repo-'))
  const vault = mkdtempSync(join(tmpdir(), 'terminal-mcp-vault-'))
  mkdirSync(join(repo, '.git'), { recursive: true }) // repo marker for the projectsDir scan
  const cfgDir = join(home, '.config', 'TerMinal')
  mkdirSync(cfgDir, { recursive: true })
  writeFileSync(join(cfgDir, 'settings.json'), JSON.stringify({ projectsDir: projects }))
  return { home, repo, vault, repoName: basename(repo) }
}

function writeTicketsConfig(repo: string, config: unknown) {
  mkdirSync(join(repo, '.TerMinal'), { recursive: true })
  writeFileSync(join(repo, '.TerMinal', 'tickets.json'), JSON.stringify(config))
}

type RpcResponse = {
  id: number
  result?: { content?: { type: string; text: string }[] }
  error?: { code: number; message: string }
}

// Drive the server over stdio: initialize + one tools/call per entry, then
// close stdin (the server exits on end). Returns responses keyed by id.
function callTools(home: string, calls: { name: string; arguments: Record<string, unknown> }[]) {
  const lines = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    ...calls.map((params, i) =>
      JSON.stringify({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params }),
    ),
  ]
  const result = spawnSync('bun', [SERVER], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: home },
    input: lines.join('\n') + '\n',
    encoding: 'utf8' as const,
  })
  expect(result.status).toBe(0)
  const byId = new Map<number, RpcResponse>()
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue
    const msg = JSON.parse(line) as RpcResponse
    if (typeof msg.id === 'number') byId.set(msg.id, msg)
  }
  return calls.map((_, i) => byId.get(i + 2)!)
}

function toolJson(res: RpcResponse): any {
  expect(res.error).toBeUndefined()
  return JSON.parse(res.result!.content![0].text)
}

function repoBacklogFiles(repo: string): string[] {
  const out: string[] = []
  for (const dir of [join(repo, 'backlog'), join(repo, '.TerMinal', 'backlog')]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) out.push(join(dir, f))
  }
  return out
}

describe('terminal-mcp-server ticket tools — obsidian provider routing', () => {
  test('file_ticket writes to the vault; list_tickets and update_ticket see only the vault', () => {
    const { home, repo, vault, repoName } = setup()
    writeTicketsConfig(repo, { provider: 'obsidian', obsidian: { vaultPath: vault } })
    // Adversarial decoy in the repo backlog: must be invisible to every tool
    // and must not influence vault id allocation.
    mkdirSync(join(repo, 'backlog'), { recursive: true })
    writeFileSync(
      join(repo, 'backlog', '0042-repo-decoy.md'),
      '---\nid: 42\ntitle: "Repo decoy"\nstatus: open\n---\n',
    )

    const [filed] = callTools(home, [
      { name: 'file_ticket', arguments: { repo: repoName, title: 'Vault MCP ticket', type: 'testing' } },
    ])
    const ticket = toolJson(filed)
    expect(ticket.slug).toBe('0001-vault-mcp-ticket')
    expect(ticket.path).toBe(join(vault, 'tickets', '0001-vault-mcp-ticket.md'))
    expect(readFileSync(ticket.path, 'utf8')).toContain('title: "Vault MCP ticket"')

    const [listed, updated, after, got] = callTools(home, [
      { name: 'list_tickets', arguments: { repo: repoName } },
      { name: 'update_ticket', arguments: { slug: '0001-vault-mcp-ticket', status: 'closed', priority: 'high' } },
      { name: 'list_tickets', arguments: { repo: repoName, status: 'all' } },
      { name: 'get_ticket', arguments: { slug: '0001-vault-mcp-ticket' } },
    ])
    // The decoy never shows up — vault is the only read source.
    expect(toolJson(listed).map((t: { slug: string }) => t.slug)).toEqual(['0001-vault-mcp-ticket'])
    expect(toolJson(updated)).toMatchObject({
      ok: true,
      path: join(vault, 'tickets', '0001-vault-mcp-ticket.md'),
    })
    expect(toolJson(after)).toEqual([
      expect.objectContaining({ slug: '0001-vault-mcp-ticket', status: 'closed', priority: 'high' }),
    ])
    expect(toolJson(got)).toMatchObject({ slug: '0001-vault-mcp-ticket', repoRoot: repo })
    // The vault file changed; the repo backlog decoy did not, and no new
    // repo-local files appeared.
    expect(readFileSync(join(vault, 'tickets', '0001-vault-mcp-ticket.md'), 'utf8')).toContain(
      'status: closed',
    )
    expect(repoBacklogFiles(repo)).toEqual([join(repo, 'backlog', '0042-repo-decoy.md')])
    expect(readFileSync(join(repo, 'backlog', '0042-repo-decoy.md'), 'utf8')).toContain(
      'status: open',
    )
  })

  test('file_ticket honors a custom ticketsSubdir', () => {
    const { home, repo, vault, repoName } = setup()
    writeTicketsConfig(repo, {
      provider: 'obsidian',
      obsidian: { vaultPath: vault, ticketsSubdir: 'issues' },
    })

    const [filed] = callTools(home, [
      { name: 'file_ticket', arguments: { repo: repoName, title: 'Subdir ticket' } },
    ])
    expect(toolJson(filed).path).toBe(join(vault, 'issues', '0001-subdir-ticket.md'))
    expect(existsSync(join(vault, 'tickets'))).toBe(false)
    expect(repoBacklogFiles(repo)).toEqual([])
  })

  test('provider obsidian without a vault path errors and never falls back to the repo backlog', () => {
    const { home, repo, repoName } = setup()
    writeTicketsConfig(repo, { provider: 'obsidian' })
    mkdirSync(join(repo, 'backlog'), { recursive: true })
    writeFileSync(
      join(repo, 'backlog', '0042-repo-decoy.md'),
      '---\nid: 42\ntitle: "Repo decoy"\nstatus: open\n---\n',
    )

    const [filed, listed, updated] = callTools(home, [
      { name: 'file_ticket', arguments: { repo: repoName, title: 'Nowhere to go' } },
      { name: 'list_tickets', arguments: { repo: repoName, status: 'all' } },
      { name: 'update_ticket', arguments: { slug: '0042-repo-decoy', status: 'closed' } },
    ])
    // Create fails loudly instead of silently writing into the repo.
    expect(filed.error?.message).toMatch(/obsidian/i)
    expect(filed.error?.message).toMatch(/vault/i)
    // Reads are vault-only: a misconfigured obsidian repo exposes nothing,
    // rather than leaking the repo backlog.
    expect(toolJson(listed)).toEqual([])
    // Updates cannot reach repo backlog files either.
    expect(updated.error?.message).toMatch(/not found/i)
    // Nothing was created or modified locally.
    expect(repoBacklogFiles(repo)).toEqual([join(repo, 'backlog', '0042-repo-decoy.md')])
    expect(readFileSync(join(repo, 'backlog', '0042-repo-decoy.md'), 'utf8')).toContain(
      'status: open',
    )
  })

  test('no provider config falls back to the repo backlog', () => {
    const { home, repo, repoName } = setup()

    const [filed, listed] = callTools(home, [
      { name: 'file_ticket', arguments: { repo: repoName, title: 'Local fallback' } },
      { name: 'list_tickets', arguments: { repo: repoName } },
    ])
    const ticket = toolJson(filed)
    expect(ticket.path).toBe(join(repo, 'backlog', '0001-local-fallback.md'))
    expect(existsSync(ticket.path)).toBe(true)
    expect(toolJson(listed).map((t: { slug: string }) => t.slug)).toEqual(['0001-local-fallback'])
  })
})
