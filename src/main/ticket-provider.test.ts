import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRepoTicket,
  getRepoTicket,
  githubIssueToTicket,
  linearIssueToTicket,
  listRepoTickets,
  obsidianDeepLink,
  obsidianRepoVault,
  repoTicketProvider,
  scaffoldObsidianVault,
  updateRepoTicket,
} from './ticket-provider'
import { readFileSync } from 'node:fs'

function repoWithTicketConfig(config?: unknown) {
  const repo = mkdtempSync(join(tmpdir(), 'terminal-ticket-provider-'))
  mkdirSync(join(repo, '.TerMinal'), { recursive: true })
  if (config !== undefined)
    writeFileSync(join(repo, '.TerMinal', 'tickets.json'), JSON.stringify(config))
  return repo
}

describe('repoTicketProvider', () => {
  test('defaults to local backlog when no provider is configured', () => {
    const repo = repoWithTicketConfig()
    expect(repoTicketProvider(repo)).toMatchObject({ kind: 'local', label: 'Local backlog' })
  })

  test('supports one configured external provider per repo', () => {
    const github = repoWithTicketConfig({ provider: 'github' })
    const linear = repoWithTicketConfig({ provider: 'linear' })

    expect(repoTicketProvider(github)).toMatchObject({ kind: 'github', label: 'GitHub Issues' })
    expect(repoTicketProvider(linear)).toMatchObject({ kind: 'linear', label: 'Linear' })
  })

  test('falls back to local for unknown provider values', () => {
    const repo = repoWithTicketConfig({ provider: 'jira' })
    expect(repoTicketProvider(repo)).toMatchObject({ kind: 'local', label: 'Local backlog' })
  })

  test('recognizes the obsidian provider', () => {
    const repo = repoWithTicketConfig({ provider: 'obsidian', obsidian: { vaultPath: '/tmp/x' } })
    expect(repoTicketProvider(repo)).toMatchObject({ kind: 'obsidian', label: 'Obsidian' })
  })

  test('obsidianRepoVault exposes vault + tickets dir only when the provider is obsidian', () => {
    const obs = repoWithTicketConfig({
      provider: 'obsidian',
      obsidian: { vaultPath: '/v/MyVault', ticketsSubdir: 'issues' },
    })
    expect(obsidianRepoVault(obs)).toEqual({
      vaultPath: '/v/MyVault',
      ticketsDir: '/v/MyVault/issues',
    })
    // configured vault block but provider is local → not exposed
    const local = repoWithTicketConfig({ provider: 'local', obsidian: { vaultPath: '/v/x' } })
    expect(obsidianRepoVault(local)).toBeNull()
    expect(obsidianRepoVault(repoWithTicketConfig({ provider: 'obsidian' }))).toBeNull()
  })
})

describe('obsidian provider dispatch', () => {
  test('writes tickets into the vault (not the repo) and stamps provider:obsidian', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'terminal-obs-vault-'))
    const repo = repoWithTicketConfig({ provider: 'obsidian', obsidian: { vaultPath: vault } })
    try {
      const t = await createRepoTicket(repo, {
        title: 'Vault route',
        type: 'feature',
        priority: 'medium',
        status: 'open',
        body: 'b',
      })
      expect(t.provider).toBe('obsidian')
      expect(t.providerLabel).toBe('Obsidian')
      // landed in <vault>/tickets/, never in the repo working tree
      expect(existsSync(join(vault, 'tickets', `${t.slug}.md`))).toBe(true)
      expect(existsSync(join(repo, 'backlog'))).toBe(false)
      const listed = await listRepoTickets(repo)
      expect(listed.map((x) => x.slug)).toContain(t.slug)
      expect(listed.every((x) => x.provider === 'obsidian')).toBe(true)
    } finally {
      rmSync(vault, { recursive: true, force: true })
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('updates and reads Obsidian tickets through the vault with sanitized slugs', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'terminal-obs-vault-'))
    const repo = repoWithTicketConfig({ provider: 'obsidian', obsidian: { vaultPath: vault } })
    try {
      const ticket = await createRepoTicket(repo, {
        title: 'Sanitize vault route',
        type: 'testing',
        priority: 'medium',
        status: 'open',
        body: 'b',
      })

      expect(
        await updateRepoTicket(repo, `../${ticket.slug}`, { status: 'closed', priority: 'high' }),
      ).toBe(true)

      const loaded = await getRepoTicket(repo, `../${ticket.slug}`)
      expect(loaded).toMatchObject({
        slug: ticket.slug,
        provider: 'obsidian',
        providerLabel: 'Obsidian',
        status: 'closed',
        priority: 'high',
      })
      expect(existsSync(join(repo, `${ticket.slug}.md`))).toBe(false)
      expect(existsSync(join(vault, 'tickets', `${ticket.slug}.md`))).toBe(true)
    } finally {
      rmSync(vault, { recursive: true, force: true })
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('missing Obsidian vault config fails closed instead of falling back to repo backlog', async () => {
    const repo = repoWithTicketConfig({ provider: 'obsidian' })
    try {
      await expect(
        createRepoTicket(repo, {
          title: 'No vault',
          type: 'testing',
          priority: 'medium',
          status: 'open',
          body: 'b',
        }),
      ).rejects.toThrow(/Obsidian vault path is not configured/)
      expect(await listRepoTickets(repo)).toEqual([])
      expect(await getRepoTicket(repo, '0001-no-vault')).toBeNull()
      expect(await updateRepoTicket(repo, '0001-no-vault', { status: 'closed' })).toBe(false)
      expect(existsSync(join(repo, 'backlog'))).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('obsidian deep link + scaffold', () => {
  test('obsidianDeepLink builds an obsidian:// URI honoring vaultName + subdir', () => {
    expect(obsidianDeepLink({ vaultPath: '/x/My Vault' }, '0001-add-x')).toBe(
      'obsidian://open?vault=My%20Vault&file=tickets%2F0001-add-x.md',
    )
    expect(
      obsidianDeepLink(
        { vaultPath: '/x/v', vaultName: 'Named', ticketsSubdir: 'issues' },
        '0002-y',
      ),
    ).toBe('obsidian://open?vault=Named&file=issues%2F0002-y.md')
    expect(obsidianDeepLink(undefined, '0001-x')).toBeNull()
    expect(obsidianDeepLink({ vaultPath: '' }, '0001-x')).toBeNull()
  })

  test('obsidianDeepLink strips traversal characters from ticket slugs', () => {
    expect(
      obsidianDeepLink({ vaultPath: '/x/v', ticketsSubdir: '/issues/' }, '../0007-escape !'),
    ).toBe('obsidian://open?vault=v&file=issues%2F0007-escape.md')
  })

  test('scaffoldObsidianVault seeds guide/board/template idempotently, never clobbering', () => {
    const vault = mkdtempSync(join(tmpdir(), 'terminal-obs-scaffold-'))
    try {
      scaffoldObsidianVault({ vaultPath: vault, ticketsSubdir: 'tickets' })
      expect(existsSync(join(vault, '_TerMinal.md'))).toBe(true)
      expect(existsSync(join(vault, '_Boards', 'Tickets.md'))).toBe(true)
      expect(existsSync(join(vault, '_Templates', 'Ticket.md'))).toBe(true)
      // Board references the tickets subdir for Dataview
      expect(readFileSync(join(vault, '_Boards', 'Tickets.md'), 'utf8')).toContain('FROM "tickets"')
      // Idempotent: a user edit survives a re-scaffold
      writeFileSync(join(vault, '_TerMinal.md'), 'MY EDIT')
      scaffoldObsidianVault({ vaultPath: vault })
      expect(readFileSync(join(vault, '_TerMinal.md'), 'utf8')).toBe('MY EDIT')
    } finally {
      rmSync(vault, { recursive: true, force: true })
    }
  })
})

describe('githubIssueToTicket', () => {
  test('normalizes GitHub issue labels into the shared ticket shape', () => {
    const ticket = githubIssueToTicket({
      number: 42,
      title: 'Fix cache race',
      state: 'OPEN',
      body: 'Race details',
      labels: [{ name: 'status:in-progress' }, { name: 'priority:high' }, { name: 'type:bug' }],
      url: 'https://github.com/acme/app/issues/42',
      createdAt: '2026-06-01T12:00:00Z',
      updatedAt: '2026-06-02T12:00:00Z',
      author: { login: 'trevor' },
    })

    expect(ticket).toMatchObject({
      slug: 'github-42',
      id: 42,
      externalKey: '#42',
      provider: 'github',
      status: 'in-progress',
      priority: 'high',
      type: 'bug',
      body: 'Race details',
      url: 'https://github.com/acme/app/issues/42',
    })
  })
})

describe('linearIssueToTicket', () => {
  test('normalizes Linear get_issue responses into the shared ticket shape', () => {
    const ticket = linearIssueToTicket({
      id: 'TRE-5',
      title: 'TerMinal smoke test',
      description: 'Smoke body',
      priority: { value: 2, name: 'High' },
      status: 'Done',
      statusType: 'completed',
      url: 'https://linear.app/acme/issue/TRE-5/terminal-smoke-test',
      createdAt: '2026-06-07T20:41:17.329Z',
      updatedAt: '2026-06-07T20:41:21.609Z',
    })

    expect(ticket).toMatchObject({
      slug: 'linear-TRE-5',
      id: 5,
      externalKey: 'TRE-5',
      provider: 'linear',
      status: 'closed',
      priority: 'high',
      body: 'Smoke body',
      url: 'https://linear.app/acme/issue/TRE-5/terminal-smoke-test',
    })
  })
})
