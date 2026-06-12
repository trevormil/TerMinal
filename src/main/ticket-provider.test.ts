import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { githubIssueToTicket, linearIssueToTicket, repoTicketProvider } from './ticket-provider'

function repoWithTicketConfig(config?: unknown) {
  const repo = mkdtempSync(join(tmpdir(), 'terminal-ticket-provider-'))
  mkdirSync(join(repo, '.TerMinal'), { recursive: true })
  if (config !== undefined) writeFileSync(join(repo, '.TerMinal', 'tickets.json'), JSON.stringify(config))
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
      url: 'https://linear.app/trevormil/issue/TRE-5/terminal-smoke-test',
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
      url: 'https://linear.app/trevormil/issue/TRE-5/terminal-smoke-test',
    })
  })
})
