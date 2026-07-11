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
