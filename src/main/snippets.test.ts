import { describe, expect, test } from 'bun:test'
import { migrateSnippetFile } from './snippets'

describe('migrateSnippetFile', () => {
  test('removes exact copied built-ins from user snippet files', () => {
    const migrated = migrateSnippetFile({
      version: 1,
      snippets: [
        {
          id: 'continue',
          title: 'Looks good. Continue',
          prompt: 'Looks good to me. Continue.',
          group: 'Common',
        },
      ],
    })

    expect(migrated).toEqual({ version: 2, snippets: [] })
  })

  test('preserves customized snippets even when they override a built-in id', () => {
    const migrated = migrateSnippetFile({
      version: 1,
      snippets: [
        {
          id: 'continue',
          title: 'Continue, but verify',
          prompt: 'Continue, but run tests before you commit.',
          group: 'Common',
        },
        {
          id: 'team-handoff',
          title: 'Team Handoff',
          prompt: 'Write a handoff note for the team.',
          group: 'Custom',
        },
      ],
    })

    expect(migrated).toEqual({
      version: 2,
      snippets: [
        {
          id: 'continue',
          title: 'Continue, but verify',
          prompt: 'Continue, but run tests before you commit.',
          group: 'Common',
        },
        {
          id: 'team-handoff',
          title: 'Team Handoff',
          prompt: 'Write a handoff note for the team.',
          group: 'Custom',
        },
      ],
    })
  })
})
