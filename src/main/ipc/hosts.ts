// Remote-host IPC (ticket 0122 index.ts decomposition) — one-time provisioning
// of a Linux host for scheduled agents, and the reachability probe the UI uses
// to degrade gracefully instead of hanging.
//
// The runner and CLI source paths differ between the packaged app (Resources)
// and a dev checkout (bin/), so index.ts owns that resolution and injects it.

import { handle } from '../typed-ipc'
import { readSettings } from '../settings'
import { provisionHost } from '../host-provision'
import { checkHostHealth } from '../host-health'

// Baked at build time from git origin (electron.vite.config.ts define). '' when
// origin is unknown → hosts skip self-update rather than track a guessed repo.
declare const __BUILD_REPO_SLUG__: string

export type HostsIpcDeps = {
  runnerSrcPath(): string
  cliSrcPath(): string
}

export function registerHostsIpc(deps: HostsIpcDeps): void {
  // Prepare a Linux host to run scheduled agents via systemd: install Bun, enable
  // linger (headless firing), install the runner, report readiness (ADR-0002 #12).
  handle('hosts:provision', async (_e, hostId: string) => {
    const host = readSettings().remoteHosts.find((h) => h.id === hostId)
    if (!host) return { ok: false, error: `unknown host: ${hostId}` }
    const engines = Object.keys(host.daemon?.engines || {})
    const r = await provisionHost(
      { sshTarget: host.sshTarget },
      deps.runnerSrcPath(),
      engines.length ? engines : ['claude', 'codex'],
      {
        cliSrcPath: deps.cliSrcPath(),
        // Hosts self-update from the repo THIS build was made from (baked at build
        // time from git origin), so a fork's hosts track the fork, not upstream.
        // '' → provisionHost skips self-update rather than guessing a repo.
        repoSlug: __BUILD_REPO_SLUG__,
      },
    )
    return { ok: r.ready, ...r }
  })
  // Reachability probe for a host (tailscale reauth / asleep / VPN down) → classified
  // reason + actionable hint, so the UI degrades gracefully instead of hanging (#20).
  handle('hosts:health', async (_e, hostId: string) => {
    const host = readSettings().remoteHosts.find((h) => h.id === hostId)
    if (!host) return { reachable: false, hint: `unknown host: ${hostId}` }
    return checkHostHealth(host.sshTarget)
  })
}
