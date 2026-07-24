import { describe, expect, it } from 'bun:test'
import { runLogAuthorized } from './run-auth'

const advertised = new Set(['alpha', 'beta'])

describe('runLogAuthorized', () => {
  it('serves a local run whose repo is advertised', () => {
    expect(runLogAuthorized({ repoLabel: 'alpha' }, advertised)).toBe(true)
  })

  it('refuses a local run whose repo is NOT advertised', () => {
    expect(runLogAuthorized({ repoLabel: 'secret' }, advertised)).toBe(false)
  })

  it('refuses an unknown run id (not found → undefined), never falls through', () => {
    expect(runLogAuthorized(undefined, advertised)).toBe(false)
  })

  it('serves a host run — the user’s own configured host, listed elsewhere', () => {
    expect(runLogAuthorized({ repoLabel: 'anything', hostId: 'tm' }, advertised)).toBe(true)
  })
})
