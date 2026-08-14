import { describe, expect, test } from 'bun:test'
import { appBundlePath, readSignatureKind } from './code-signature'

// Ticket 93. The Settings "Test" button has to report what is TRUE of the
// running build. Getting this wrong is not cosmetic in either direction:
//
//   say "unsigned" on a signed build  → the user distrusts a channel that works
//   say nothing on an unsigned build  → the button claims success and nothing
//                                       ever appears (the Electron 42 trap)
//
// So the detection is measured, and these tests pin the parsing against real
// `codesign -dv` output rather than a guess at its shape.

// The identities below are placeholders. The shape is what these fixtures pin —
// a real signing identity and team id in a public repo is an identifier leak
// that teaches nothing extra about the parsing.

/** `codesign -dv` output from a Developer ID-signed, notarized TerMinal.app. */
const DEVELOPER_ID = `Executable=/Applications/TerMinal.app/Contents/MacOS/TerMinal
Identifier=com.terminal.app
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=12+7
Signature size=9000
Authority=Developer ID Application: Example Dev (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=Aug 1, 2026 at 9:32:28 AM
Info.plist entries=30
TeamIdentifier=ABCDE12345
Runtime Version=26.4.0
Sealed Resources version=2 rules=13 files=200`

/** Real output from the ad-hoc path bin/release used before this ticket. */
const ADHOC = `Executable=/Applications/TerMinal.app/Contents/MacOS/TerMinal
Identifier=com.terminal.app
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=1234 flags=0x2(adhoc) hashes=12+7
Signature=adhoc
Info.plist entries=30
TeamIdentifier=not set
Sealed Resources version=2 rules=13 files=200`

/** An Apple Development cert — signed, but NOT trusted for distribution. */
const APPLE_DEVELOPMENT = `Executable=/x/Contents/MacOS/x
Identifier=com.terminal.app
Authority=Apple Development: Example Dev (ABCDE12345)
Authority=Apple Worldwide Developer Relations Certification Authority
Authority=Apple Root CA
TeamIdentifier=ABCDE12345`

const stub = (out: string) => (): string => out
const throwing = (text: string) => (): string => {
  const e = new Error('Command failed') as Error & { stderr: string }
  e.stderr = text
  throw e
}

describe('readSignatureKind (ticket 93)', () => {
  const darwinOnly = process.platform === 'darwin'

  test.if(darwinOnly)('a Developer ID signature is recognised', () => {
    expect(readSignatureKind('/x', stub(DEVELOPER_ID))).toBe('developer-id')
  })

  test.if(darwinOnly)('an ad-hoc signature is NOT good enough', () => {
    // This is the case that matters: ad-hoc passes `codesign --verify` happily,
    // so anything checking only "is it signed" would wrongly say yes.
    expect(readSignatureKind('/x', stub(ADHOC))).toBe('unsigned')
  })

  test.if(darwinOnly)('an Apple Development cert is not a distribution identity', () => {
    // Signed, chains to Apple Root, and still not trusted by Gatekeeper or
    // UNNotification. "Has an Authority line" is not the test.
    expect(readSignatureKind('/x', stub(APPLE_DEVELOPMENT))).toBe('unsigned')
  })

  test.if(darwinOnly)('a completely unsigned bundle reports unsigned, not unknown', () => {
    // codesign EXITS NON-ZERO here, so a naive implementation throws and
    // reports 'unknown' — losing the one answer the user needs.
    expect(readSignatureKind('/x', throwing('/x: code object is not signed at all'))).toBe(
      'unsigned',
    )
  })

  test.if(darwinOnly)('an unreadable result claims nothing rather than guessing', () => {
    expect(readSignatureKind('/x', throwing(''))).toBe('unknown')
  })

  test.if(!darwinOnly)('off macOS it claims nothing — the issue is macOS-specific', () => {
    // Runs only where it can be observed. Asserting on the transpiled function
    // body from macOS looked like coverage but tested the bundler, not the
    // behaviour — and would break on any refactor that says the same thing
    // differently.
    expect(readSignatureKind('/x', stub(DEVELOPER_ID))).toBe('unknown')
  })

  test.if(darwinOnly)('the runner reads BOTH streams, not just stdout', () => {
    // The bug this file exists to prevent: `codesign -dv` reports on STDERR and
    // exits 0, so a stdout-only reader sees nothing and calls a signed app
    // unsigned. Exercised against the real binary, with no stub.
    const real = readSignatureKind('/System/Applications/Calculator.app')
    // Apple's own apps are signed by Apple, not a Developer ID — the point here
    // is only that we got OUTPUT to classify rather than an empty string.
    expect(real).not.toBe('unknown')
  })
})

describe('appBundlePath resolves the BUNDLE, not the inner binary (ticket 93)', () => {
  test('a packaged path climbs out to the .app', () => {
    // codesign on Contents/MacOS/TerMinal reports on the executable, not the
    // app — different answer, and not the one Gatekeeper uses.
    expect(appBundlePath('/Applications/TerMinal.app/Contents/MacOS/TerMinal')).toBe(
      '/Applications/TerMinal.app',
    )
  })

  test('a dev/electron path is passed through unchanged', () => {
    expect(appBundlePath('/repo/node_modules/electron/dist/electron')).toBe(
      '/repo/node_modules/electron/dist/electron',
    )
  })

  test('a path with .app elsewhere in it is not mangled', () => {
    expect(appBundlePath('/Users/me/my.apps/tool')).toBe('/Users/me/my.apps/tool')
  })
})

describe('the installed app is actually signed (ticket 93, live check)', () => {
  // Not a unit test — a claim about ONE machine's install, and an opt-in one.
  // A contributor who installed an unsigned local build (the documented
  // TERMINAL_UNSIGNED=1 path) is not broken, so this must not fail their suite:
  // it runs only when the operator asks for it with
  // TERMINAL_VERIFY_INSTALLED_SIGNATURE=1, and only when the app is present.
  const installed = '/Applications/TerMinal.app'
  const opted = process.env.TERMINAL_VERIFY_INSTALLED_SIGNATURE === '1'
  const present =
    opted && process.platform === 'darwin' && Bun.file(`${installed}/Contents/Info.plist`).size > 0

  test.if(present)('/Applications/TerMinal.app carries a Developer ID signature', () => {
    expect(readSignatureKind(installed)).toBe('developer-id')
  })
})
