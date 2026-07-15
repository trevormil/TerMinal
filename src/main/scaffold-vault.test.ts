import { describe, expect, test } from 'bun:test'
import { resolveObsidianScaffold } from './scaffold-vault'

describe('resolveObsidianScaffold', () => {
  const dest = '/projects/app'
  const parent = '/projects'
  const safe = 'app'

  test('sibling (default): a <name>-vault next to the repo, only tickets.json ignored', () => {
    expect(resolveObsidianScaffold(dest, parent, safe, { kind: 'obsidian' })).toEqual({
      vaultPath: '/projects/app-vault',
      ignore: ['.TerMinal/tickets.json'],
    })
    // explicit sibling is the same
    expect(
      resolveObsidianScaffold(dest, parent, safe, { kind: 'obsidian', vaultLocation: 'sibling' })
        .vaultPath,
    ).toBe('/projects/app-vault')
  })

  test('in-repo: a gitignored tickets-vault/ inside the repo', () => {
    const r = resolveObsidianScaffold(dest, parent, safe, {
      kind: 'obsidian',
      vaultLocation: 'in-repo',
    })
    expect(r.vaultPath).toBe('/projects/app/tickets-vault')
    expect(r.ignore).toEqual(['.TerMinal/tickets.json', '/tickets-vault/'])
  })

  test('existing: uses the provided path, only tickets.json ignored', () => {
    const r = resolveObsidianScaffold(dest, parent, safe, {
      kind: 'obsidian',
      vaultLocation: 'existing',
      vaultPath: '  /Users/me/MyVault  ',
    })
    expect(r.vaultPath).toBe('/Users/me/MyVault') // trimmed
    expect(r.ignore).toEqual(['.TerMinal/tickets.json'])
  })

  test('existing with no path falls back to the sibling default', () => {
    expect(
      resolveObsidianScaffold(dest, parent, safe, { kind: 'obsidian', vaultLocation: 'existing' })
        .vaultPath,
    ).toBe('/projects/app-vault')
  })
})
