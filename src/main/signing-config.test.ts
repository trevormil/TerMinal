import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Ticket 93. Signing is the kind of thing that is either correct or produces a
// confusing runtime failure nobody connects back to config — an app that dies
// on launch with a code-signing kill, or a terminal that silently refuses to
// spawn. None of that surfaces in a unit test of app behaviour, so what IS
// testable is the configuration itself.
//
// Every assertion below corresponds to a specific way a hardened-runtime
// Electron build breaks.

const ROOT = resolve(import.meta.dir, '../..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

const ENTITLEMENTS = 'build/entitlements.mac.plist'
const BUILDER = 'electron-builder.yml'
const RELEASE = 'bin/release'
const WORKFLOW = '.github/workflows/release.yml'

describe('hardened-runtime entitlements (ticket 93)', () => {
  const plist = read(ENTITLEMENTS)
  const has = (key: string): boolean => plist.includes(`<key>${key}</key>`)

  test('JIT is allowed — without it V8 is killed at launch', () => {
    expect(has('com.apple.security.cs.allow-jit')).toBe(true)
    expect(has('com.apple.security.cs.allow-unsigned-executable-memory')).toBe(true)
  })

  test('library validation is disabled — node-pty/better-sqlite3 are unpacked .node files', () => {
    // This is the one whose absence produces the nastiest symptom: the app
    // launches fine and the TERMINAL silently fails to spawn.
    expect(has('com.apple.security.cs.disable-library-validation')).toBe(true)
  })

  test('child processes inherit, and dyld env vars survive', () => {
    // TerMinal's entire purpose is spawning agent CLIs from a login shell.
    expect(has('com.apple.security.cs.inherit')).toBe(true)
    expect(has('com.apple.security.cs.allow-dyld-environment-variables')).toBe(true)
  })

  test('user-selected files are readable — sessions open repos anywhere', () => {
    expect(has('com.apple.security.files.user-selected.read-write')).toBe(true)
  })

  test('it does NOT grant entitlements the app has no use for', () => {
    // Each entitlement widens what a compromised renderer can attempt. The
    // sandbox one in particular would break the app outright while *looking*
    // like hardening.
    for (const over of [
      'com.apple.security.app-sandbox',
      'com.apple.security.cs.allow-executable-memory', // not a real key; a typo'd guess
      'com.apple.security.device.camera',
      'com.apple.security.device.microphone',
      'com.apple.security.personal-information.location',
    ]) {
      expect(has(over), `${over} should not be granted`).toBe(false)
    }
  })

  test('it is a valid plist Apple will accept', () => {
    expect(plist).toContain('<!DOCTYPE plist')
    expect(plist).toContain('<plist version="1.0">')
    // Balanced dict, and every <key> has a value sibling.
    expect((plist.match(/<dict>/g) || []).length).toBe((plist.match(/<\/dict>/g) || []).length)
    const keys = (plist.match(/<key>/g) || []).length
    const bools = (plist.match(/<(?:true|false)\/>/g) || []).length
    expect(bools).toBe(keys)
  })
})

describe('electron-builder is configured for notarization (ticket 93)', () => {
  const yml = read(BUILDER)

  test('hardened runtime is on — notarization is refused without it', () => {
    expect(yml).toMatch(/hardenedRuntime:\s*true/)
  })

  test('both entitlements files point at the plist above', () => {
    // entitlementsInherit is the one people forget; without it the helper
    // processes get the parent's entitlements and the app fails to launch.
    expect(yml).toMatch(/entitlements:\s*build\/entitlements\.mac\.plist/)
    expect(yml).toMatch(/entitlementsInherit:\s*build\/entitlements\.mac\.plist/)
  })

  test('identity is no longer pinned to null', () => {
    // `identity: null` forces ad-hoc signing regardless of what is in the
    // keychain — it was the single line making every build unsigned.
    expect(yml).not.toMatch(/^\s*identity:\s*null\s*$/m)
  })
})

describe('bin/release signs, notarizes and PROVES it (ticket 93)', () => {
  const sh = read(RELEASE)

  test('it detects a Developer ID identity rather than requiring a flag', () => {
    // A contributor without the cert must still get a working build; an
    // operator with it must not have to remember to opt in.
    expect(sh).toContain('Developer ID Application')
    expect(sh).toContain('TERMINAL_UNSIGNED')
  })

  test('it signs with the hardened runtime and a secure timestamp', () => {
    // --timestamp matters beyond pedantry: without it the signature stops
    // validating the moment the certificate expires, even for already-shipped
    // builds.
    expect(sh).toMatch(/--options runtime/)
    expect(sh).toMatch(/--timestamp/)
  })

  test('it does NOT use codesign --deep on the signed path', () => {
    // --deep signs nested code with the OUTER entitlements, silently stripping
    // inherit from helpers. Apple deprecated it. electron-builder already
    // signed the nested binaries correctly during `dist`.
    const signed = sh.slice(sh.indexOf('signing as:'), sh.indexOf('notarized + stapled'))
    expect(signed).not.toMatch(/codesign[^\n]*--deep/)
  })

  test('it staples BOTH the app and the dmg', () => {
    // The .app is what lands in /Applications; the .dmg is what gets published.
    // Stapling only the dmg leaves the installed copy needing a network call.
    expect(sh).toMatch(/stapler staple "\$APP"/)
    expect(sh).toMatch(/stapler staple "\$DMG"/)
  })

  test('it asserts with spctl, not just codesign --verify', () => {
    // `codesign --verify` passes on an un-notarized build. Only Gatekeeper
    // assessment tells you a downloader will actually be let through — the
    // difference between "we signed it" and "it works".
    expect(sh).toMatch(/spctl --assess/)
  })

  test('notarization failure is fatal, not a warning', () => {
    expect(sh).toMatch(/set -euo pipefail/)
  })
})

describe('the self-update provenance gate (ticket 93 / F-14)', () => {
  const sh = read(RELEASE)
  const gate = sh.slice(sh.indexOf('provenance gate'), sh.indexOf('bun run dist'))

  test('it only arms for self-update builds', () => {
    // A human building a feature branch at a terminal is doing so deliberately.
    expect(gate).toContain('TERMINAL_SELF_UPDATE')
  })

  test('it refuses a dirty tree', () => {
    // Otherwise uncommitted changes get signed and installed as a "release".
    expect(gate).toMatch(/git status --porcelain/)
    expect(gate).toMatch(/exit 1/)
  })

  test('it requires HEAD to be reachable from the published default branch', () => {
    expect(gate).toMatch(/merge-base --is-ancestor/)
  })

  test('the app actually arms it — an unreachable gate is not a gate', () => {
    const main = read('src/main/index.ts')
    expect(main).toContain("TERMINAL_SELF_UPDATE: '1'")
  })

  test('it does not claim signature verification it cannot do', () => {
    // The repo does not sign tags, so `git verify-tag` would pass vacuously and
    // give false assurance. An honest weaker gate beats a fake strong one.
    //
    // Checks for an INVOCATION, not the words: the script deliberately explains
    // in a comment why verify-tag is absent, and that comment is worth keeping.
    const code = gate
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n')
    expect(code).not.toMatch(/git\s+verify-(tag|commit)/)
  })
})

describe('CI signing degrades instead of breaking forks (ticket 93)', () => {
  const wf = read(WORKFLOW)

  test('signing steps are gated on the secret existing', () => {
    // A fork, or this repo before secrets are set, must still build.
    expect(wf).toMatch(/steps\.signing\.outputs\.available == 'true'/)
  })

  test('the cert goes into a throwaway keychain, not the login one', () => {
    expect(wf).toContain('create-keychain')
    expect(wf).toContain('RUNNER_TEMP')
  })

  test('the partition list is set — otherwise codesign hangs on a GUI prompt', () => {
    expect(wf).toContain('set-key-partition-list')
  })

  test('secrets on disk are removed after use', () => {
    expect(wf).toMatch(/rm -f "\$RUNNER_TEMP\/cert\.p12"/)
    expect(wf).toMatch(/rm -f "\$KEY"/)
  })

  test('checksums are computed AFTER stapling', () => {
    // Stapling rewrites the dmg. Checksums taken before it describe a file
    // nobody will ever download.
    expect(wf.indexOf('Notarize + staple')).toBeLessThan(wf.indexOf('name: Checksums'))
  })
})
