// Gate for shell.openExternal: only hand URLs to the OS handler when they are
// web/mail schemes. Electron's openExternal forwards file://, smb://, vscode://
// and other OS-registered custom-scheme URLs straight to their handler, so an
// unvalidated link in rendered markdown/notes/agent output could invoke a local
// file or protocol handler. Allowlist http(s)/mailto; refuse everything else.
export function isExternallyOpenableUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const proto = new URL(url).protocol
    return proto === 'http:' || proto === 'https:' || proto === 'mailto:'
  } catch {
    return false
  }
}

/**
 * Stricter gate for values that become an iframe `src`: http(s) only. `mailto:`
 * is fine to hand the OS but meaningless (and, via the OS handler, surprising)
 * as a frame source, so it is excluded here.
 */
export function isHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const proto = new URL(url).protocol
    return proto === 'http:' || proto === 'https:'
  } catch {
    return false
  }
}

/**
 * `tickets:open-in-obsidian` needs a custom scheme, which `isExternallyOpenableUrl`
 * (correctly) refuses. Rather than punch a hole in that gate, this narrowly
 * validates the one deep link we mint ourselves — obsidian://open?… and nothing
 * else — so a hostile vault/file value can't turn the sink into a generic
 * custom-scheme launcher.
 */
export function isObsidianDeepLink(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    // obsidian://open?… parses with host 'open' and an empty pathname.
    return u.protocol === 'obsidian:' && u.host === 'open' && u.pathname === ''
  } catch {
    return false
  }
}
