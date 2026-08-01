// Is the RUNNING app signed with a Developer ID? (ticket 93)
//
// This exists because of a specific way the UI can lie. Electron 42 moved macOS
// notifications to UNNotification, which only delivers for a signed app — so an
// unsigned build's "Test" button reports success while nothing appears. The fix
// for that was a caveat in Settings; but a caveat shown unconditionally is just
// the same lie pointing the other way once the app IS signed.
//
// So the answer has to be measured, not assumed.

import { spawnSync } from 'node:child_process'

export type SignatureKind =
  /** Signed by a Developer ID Application cert — notifications work. */
  | 'developer-id'
  /** Ad-hoc or unsigned — macOS will silently drop notifications. */
  | 'unsigned'
  /** Not macOS, or we could not tell. Claim nothing. */
  | 'unknown'

/**
 * Read the signing authority off a bundle.
 *
 * `codesign -dv` writes to STDERR (not stdout) even on success, which is the
 * usual reason a check like this silently returns "unsigned" for a signed app.
 */
export function readSignatureKind(
  bundlePath: string,
  // Both streams, concatenated. `codesign -dv` writes its report to STDERR and
  // still exits 0, so a stdout-only reader sees NOTHING and concludes the app
  // is unsigned — which is precisely the wrong answer, and the bug this
  // function's own comment warned about before it had one.
  run: (cmd: string, args: string[]) => string = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 })
    if (r.error) throw r.error
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
    if (r.status !== 0) {
      const e = new Error(`codesign exited ${r.status}`) as Error & { stderr: string }
      e.stderr = text
      throw e
    }
    return text
  },
): SignatureKind {
  if (process.platform !== 'darwin') return 'unknown'
  let out: string
  try {
    out = run('codesign', ['-dv', '--verbose=2', bundlePath])
  } catch (e) {
    // execFileSync throws on a non-zero exit — which is exactly what an
    // UNSIGNED bundle produces ("code object is not signed at all"). That is an
    // answer, not a failure, so read the output rather than giving up.
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string }
    const text = String(err.stderr ?? '') + String(err.stdout ?? '')
    if (/not signed at all/i.test(text)) return 'unsigned'
    if (!text) return 'unknown'
    out = text
  }
  if (/Authority=Developer ID Application/.test(out)) return 'developer-id'
  // An ad-hoc signature has a linker-signed / no-authority flag and no chain.
  if (/Signature=adhoc/i.test(out) || !/Authority=/.test(out)) return 'unsigned'
  // Signed, but by something else (Apple Development, a self-signed cert). Not
  // a Developer ID, so Gatekeeper and UNNotification still treat it as untrusted.
  return 'unsigned'
}

let cached: SignatureKind | null = null

/**
 * The running app's signature kind, computed once.
 *
 * Cached because it cannot change while the process lives, and because this is
 * read on a UI path — shelling out to codesign on every Settings render would
 * be a visible stall.
 */
export function appSignatureKind(bundlePath = appBundlePath()): SignatureKind {
  if (cached === null) cached = readSignatureKind(bundlePath)
  return cached
}

/** Reset the memo — tests only. */
export function resetSignatureCache(): void {
  cached = null
}

/**
 * The .app bundle enclosing this process.
 *
 * `process.execPath` in a packaged build is
 * `…/TerMinal.app/Contents/MacOS/TerMinal`; codesign wants the bundle root, and
 * pointing it at the inner binary reports on the executable rather than the
 * app. In dev it is the Electron binary, which is signed by Electron's own
 * Developer ID — correctly reported, since notifications do work in dev.
 */
export function appBundlePath(execPath = process.execPath): string {
  const marker = '.app/Contents/MacOS/'
  const i = execPath.indexOf(marker)
  return i === -1 ? execPath : execPath.slice(0, i + '.app'.length)
}
