// Command-widget + custom-tab IPC (ticket 0122 index.ts decomposition), and
// the repo-trust approval surface that gates them.
//
// The two trust rules this module enforces used to be renderer convention only;
// the header comment below is the contract. `openSessionCwd` needs to know
// which cwds the user actually has open, which is session state — injected.

import { basename } from 'node:path'
import { handle } from '../typed-ipc'
import { emitActivity } from '../events'
import { readSettings } from '../settings'
import { listCommandWidgets, runCommand, repoRoot as widgetRepoRoot } from '../widgets'
import { listCustomTabs, runTabCommand } from '../tabs'
import {
  approveRepo,
  commandSetHash,
  isRepoTrusted,
  readTrustStore,
  revokeRepo,
  writeTrustStore,
} from '../repo-trust'

export type WidgetsIpcDeps = {
  cur(): { cwd: string; sessionId: string }
  /** The cwd of every session the user actually has open. */
  openCwds(): string[]
}

export function registerWidgetsIpc(deps: WidgetsIpcDeps): void {
  // ---- command widgets + custom tabs (declarative, per-repo extensible) ------
  //
  // Two trust rules live here, both of which used to be enforced only by renderer
  // convention:
  //
  //  1. The renderer never supplies a COMMAND, only an opaque widget/tab id. Main
  //     resolves it against the widget set for the session's own cwd, so the
  //     "run an arbitrary shell string" sink no longer exists on the IPC surface.
  //  2. REPO-sourced entries (.TerMinal/widgets.json, .TerMinal/tabs.json) are
  //     inert until the user approves that repo for that exact command set — see
  //     repo-trust.ts. GLOBAL entries (~/.config/TerMinal) are the user's own
  //     files and behave exactly as before.
  function repoTrustContext(cwd: string) {
    // Global kill switch ABOVE the per-repo trust flow: with repo extensions
    // disabled (the default), repo-sourced widgets/tabs are never listed, never
    // runnable, and never even prompt for approval — the surface doesn't exist.
    // Global entries (~/.config/TerMinal) are the user's own files and unaffected.
    const allowRepo = readSettings().allowRepoExtensions
    const widgets = listCommandWidgets(cwd).filter((w) => allowRepo || w.source !== 'repo')
    const tabs = listCustomTabs(cwd).filter((t) => allowRepo || t.source !== 'repo')
    const root = cwd ? widgetRepoRoot(cwd) : ''
    const commands = [
      ...widgets.filter((w) => w.source === 'repo').map((w) => `widget: ${w.command}`),
      ...tabs
        .filter((t) => t.source === 'repo')
        .map((t) => (t.command ? `tab: ${t.command}` : `tab url: ${t.url}`)),
    ]
    const hash = commandSetHash(commands)
    return {
      repoRoot: root,
      hash,
      commands,
      widgets,
      tabs,
      trusted: isRepoTrusted(readTrustStore(), root, hash),
    }
  }
  /** Global entries are always live; repo entries only once the repo is approved. */
  const entryTrusted = (source: 'global' | 'repo', repoTrusted: boolean) =>
    source === 'global' || repoTrusted

  handle('widgets:list', () => {
    const ctx = repoTrustContext(deps.cur().cwd)
    return ctx.widgets.map((w) => ({ ...w, trusted: entryTrusted(w.source, ctx.trusted) }))
  })
  handle('widgets:run', (_e, id: string) => {
    const cwd = deps.cur().cwd
    const ctx = repoTrustContext(cwd)
    const w = ctx.widgets.find((x) => x.id === id)
    if (!w) return { ok: false, stdout: 'unknown widget', code: 127 }
    if (!entryTrusted(w.source, ctx.trusted))
      return { ok: false, stdout: 'repo not trusted — approve it in the Plugins drawer', code: 126 }
    return runCommand(w.command, cwd)
  })

  // A renderer-supplied cwd is a REQUEST, never an authority: it is only honoured
  // when it belongs to a session the user actually has open. Otherwise a
  // compromised renderer could name any directory on disk — approve it, then run
  // its widgets — which would defeat the trust gate entirely.
  const openSessionCwd = (cwd?: string): string => {
    if (!cwd) return deps.cur().cwd
    if (deps.openCwds().includes(cwd)) return cwd
    console.error('[gt] refused a cwd that is not an open session:', String(cwd).slice(0, 120))
    return deps.cur().cwd
  }

  handle('tabs:list', (_e, cwd?: string) => {
    const ctx = repoTrustContext(openSessionCwd(cwd))
    return ctx.tabs.map((t) => ({ ...t, trusted: entryTrusted(t.source, ctx.trusted) }))
  })
  handle('tabs:run', (_e, id: string, cwd?: string) => {
    const dir = openSessionCwd(cwd)
    const ctx = repoTrustContext(dir)
    const t = ctx.tabs.find((x) => x.id === id)
    if (!t?.command) return { ok: false, html: 'unknown tab', code: 127 }
    if (!entryTrusted(t.source, ctx.trusted))
      return { ok: false, html: 'repo not trusted — approve it in the Plugins drawer', code: 126 }
    return runTabCommand(t.command, dir)
  })

  // The approval surface: the literal commands the repo wants to run, so the user
  // approves what they can actually read.
  handle('repoTrust:status', () => {
    const ctx = repoTrustContext(deps.cur().cwd)
    return { repoRoot: ctx.repoRoot, hash: ctx.hash, trusted: ctx.trusted, commands: ctx.commands }
  })
  // Deliberately takes NO cwd. Granting trust is the one operation the renderer
  // must not be able to point anywhere: `approve('/attacker/repo')` followed by
  // `tabs:run(id, '/attacker/repo')` would walk straight around the gate. The
  // approval always applies to the session the user is actually looking at.
  handle('repoTrust:approve', () => {
    const ctx = repoTrustContext(deps.cur().cwd)
    if (!ctx.repoRoot || !ctx.commands.length) return false
    writeTrustStore(approveRepo(readTrustStore(), ctx.repoRoot, ctx.hash))
    emitActivity({
      kind: 'check',
      title: `Trusted repo widgets · ${basename(ctx.repoRoot)}`,
      detail: `${ctx.commands.length} repo-defined command${ctx.commands.length > 1 ? 's' : ''} approved`,
    })
    return true
  })
  handle('repoTrust:revoke', () => {
    const ctx = repoTrustContext(deps.cur().cwd)
    if (!ctx.repoRoot) return false
    writeTrustStore(revokeRepo(readTrustStore(), ctx.repoRoot))
    return true
  })
}
