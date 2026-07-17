import { describe, expect, test } from 'bun:test'
import { firstRunPhase, repoOrientationKey, shouldAutoShowRepoOrientation } from './orientation'

describe('firstRunPhase', () => {
  test('loading while settings have not resolved', () => {
    expect(
      firstRunPhase({ onboarded: null, completedThisSession: false, orientationDismissed: false }),
    ).toBe('loading')
  })

  test('setup when not onboarded', () => {
    expect(
      firstRunPhase({ onboarded: false, completedThisSession: false, orientationDismissed: false }),
    ).toBe('setup')
  })

  test('orient shows exactly on the first-run transition', () => {
    expect(
      firstRunPhase({ onboarded: true, completedThisSession: true, orientationDismissed: false }),
    ).toBe('orient')
  })

  test('never orients when onboarded was already true at launch', () => {
    // A returning user: onboarded loads true from disk, nothing was completed
    // this session — the app must go straight in, no orientation.
    expect(
      firstRunPhase({ onboarded: true, completedThisSession: false, orientationDismissed: false }),
    ).toBe('app')
  })

  test('dismissing the orientation is terminal for the session', () => {
    expect(
      firstRunPhase({ onboarded: true, completedThisSession: true, orientationDismissed: true }),
    ).toBe('app')
  })

  test('replay: clearing onboarded re-enters setup even after a completed run', () => {
    // Settings "Replay onboarding" patches onboarded:false mid-session. Setup
    // must win over a stale completedThisSession from the earlier pass.
    expect(
      firstRunPhase({ onboarded: false, completedThisSession: true, orientationDismissed: true }),
    ).toBe('setup')
  })
})

describe('shouldAutoShowRepoOrientation', () => {
  const fresh = { repoRoot: '/Users/x/code/newrepo', hasAgents: false, hasBacklog: false }
  const none = () => false

  test('auto-shows for a fresh local repo', () => {
    expect(shouldAutoShowRepoOrientation(fresh, none)).toBe(true)
  })

  test('never shows outside a repo', () => {
    expect(shouldAutoShowRepoOrientation({ ...fresh, repoRoot: '' }, none)).toBe(false)
  })

  test('never shows for remote workspaces', () => {
    expect(shouldAutoShowRepoOrientation({ ...fresh, remote: true }, none)).toBe(false)
  })

  test('established repos (agents or backlog present) are left alone', () => {
    expect(shouldAutoShowRepoOrientation({ ...fresh, hasAgents: true }, none)).toBe(false)
    expect(shouldAutoShowRepoOrientation({ ...fresh, hasBacklog: true }, none)).toBe(false)
  })

  test('respects the per-repo dismissal', () => {
    const dismissed = (key: string) => key === repoOrientationKey(fresh.repoRoot)
    expect(shouldAutoShowRepoOrientation(fresh, dismissed)).toBe(false)
  })

  test('dismissal is scoped per repo, not global', () => {
    const dismissed = (key: string) => key === repoOrientationKey('/Users/x/code/other')
    expect(shouldAutoShowRepoOrientation(fresh, dismissed)).toBe(true)
  })
})

describe('repoOrientationKey', () => {
  test('keys are distinct per repoRoot', () => {
    expect(repoOrientationKey('/a')).not.toBe(repoOrientationKey('/b'))
  })
})
