// Settings IPC (ticket 0122 index.ts decomposition) — the Settings pane's
// read/write surface plus the prompt-snippet and preset stores it owns.
//
// Two things are injected rather than imported. `applyBridgeSetting` lives in
// index.ts because startup calls it too, and `settings:patch` must re-bind the
// mobile bridge the instant the toggle or port changes. The session accessors
// are the same ones every other repo-scoped registrar takes.

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { handle } from '../typed-ipc'
import { emitActivity } from '../events'
import { repoRootOf } from '../repo'
import { markTelegramControlEnabled } from '../telegram'
import { clearTerminalScratch, sweepTerminalState } from '../run-retention'
import { maskSettingsSecrets, stripMaskedSecrets } from '../settings-mask'
import {
  CANDIDATE_ROOT_NAMES,
  classifyProjectsDir,
  countGitReposOneLevel,
  patchSettings,
  pickDensestRoot,
  readSettings,
  type Settings,
  type SettingsPatch,
} from '../settings'
import { remoteProbe, remoteSettings, type RemoteSessionRef } from '../remote'
import { BUILT_IN_SNIPPETS, listPromptSnippets, savePromptSnippet } from '../snippets'
import { hidePreset, readPresetPrefs, restorePreset, type PresetKind } from '../presets'
import { DEFAULT_AGENTS } from '../agents'

export type SettingsIpcDeps = {
  cur(): { cwd: string; sessionId: string }
  remoteFromHostId(hostId: string, cwd?: string): RemoteSessionRef | null
  repoLabelFor(cwdOrRoot: string): string
  /** Re-bind (or unbind) the mobile bridge after a settings write. */
  applyBridgeSetting(): Promise<void>
}

export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  // Secrets are sealed on disk; handing the renderer the decrypted values on
  // every read undoes that. It gets masks plus a `secretsSet` map instead — see
  // settings-mask.ts. Writes still work: only an actual edit is saved.
  handle('settings:get', () => maskSettingsSecrets(readSettings()))
  handle('settings:storage-report', () => sweepTerminalState(undefined, { dryRun: true }))
  handle('settings:storage-reclaim', async () => {
    const report = await sweepTerminalState(undefined, { dryRun: false })
    emitActivity(
      {
        kind: 'info',
        title: 'Storage reclaim completed',
        detail: `${report.reclaimedBytes} bytes reclaimed`,
      },
      { notify: false },
    )
    return report
  })
  handle('settings:scratch-clear', () => clearTerminalScratch())
  handle('settings:patch', (_e, patch: SettingsPatch) => {
    const before = readSettings()
    // The renderer now holds masks where secrets used to be. If one is echoed back
    // (a form that re-submits every field, say), persisting it would overwrite a
    // real credential with '••••••••'. Strip those before patching.
    //
    // patchSettings THROWS on a corrupt settings.json (it quarantines the file
    // rather than overwriting real config with defaults). Surface that in the
    // Activity feed and hand back the unchanged settings — an uncaught throw here
    // is an unhandled rejection in the renderer and the user sees nothing at all.
    let next: Settings
    try {
      next = patchSettings(stripMaskedSecrets(patch))
    } catch (e) {
      emitActivity({
        kind: 'blocked',
        title: 'Settings not saved',
        detail: e instanceof Error ? e.message : String(e),
      })
      // Masked for the same reason settings:get is — the renderer must never
      // receive a real credential back, least of all on the failure path.
      return maskSettingsSecrets(before)
    }
    // react when the AFK-control toggle actually flips
    if (next.telegram.control !== before.telegram.control) {
      markTelegramControlEnabled(next.telegram.control).catch((e: unknown) =>
        console.error('[gt] telegram: applying control toggle failed:', e),
      )
      emitActivity({
        kind: 'info',
        title: `Telegram control ${next.telegram.control ? 'enabled' : 'disabled'}`,
        detail: 'Settings updated',
      })
    }
    if (next.telegram.notify !== before.telegram.notify) {
      emitActivity({
        kind: 'info',
        title: `Activity notifications ${next.telegram.notify ? 'enabled' : 'disabled'}`,
        detail: 'Settings updated',
      })
    }
    // Bind/unbind the mobile bridge the moment the toggle or port changes, so the
    // listening socket always matches what Settings claims.
    if (next.bridge.enabled !== before.bridge.enabled || next.bridge.port !== before.bridge.port) {
      void deps.applyBridgeSetting()
    }
    // Mask on the way back out too. The renderer feeds this straight into its
    // settings state, so returning raw `next` would both leak cleartext secrets
    // and drop `secretsSet` — making all five secret fields render "not set".
    return maskSettingsSecrets(next)
  })
  handle('settings:remote-probe', async (_e, hostId: string) => {
    const host = readSettings().remoteHosts.find((h) => h.id === hostId)
    if (!host) return { ok: false, error: 'remote host not found', engines: {}, tools: {} }
    try {
      const probe = await remoteProbe({
        hostId: host.id,
        label: host.label,
        sshTarget: host.sshTarget,
        cwd: host.defaultCwd || host.daemon.projectsDir || '~',
        platform: host.platform,
      })
      return {
        ok: true,
        cwd: probe.cwd,
        repoRoot: probe.repoRoot,
        engines: probe.engines,
        tools: probe.tools,
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message, engines: {}, tools: {} }
    }
  })
  // Real-fs bindings for the pure projects-dir discovery helpers in settings.ts.
  function projectsDirFs() {
    return {
      hasGitDir: (d: string) => existsSync(join(d, '.git')),
      listChildren: (d: string) => readdirSync(d),
      resolveHome: () => homedir(),
      candidateRoots: () => CANDIDATE_ROOT_NAMES.map((n) => (n ? join(homedir(), n) : homedir())),
    }
  }
  handle('settings:validate-projects-dir', async (_e, input: { dir?: string; hostId?: string }) => {
    const dir = input?.dir || ''
    if (input?.hostId) {
      const remote = deps.remoteFromHostId(input.hostId, dir || undefined)
      if (!remote) return { ok: false, reason: 'error', dir, message: 'remote host not found' }
      return remoteSettings.validateProjectsDir(remote, dir).catch((e) => ({
        ok: false,
        reason: 'error',
        dir,
        message: (e as Error).message,
      }))
    }
    return classifyProjectsDir(dir, projectsDirFs())
  })
  handle('settings:suggest-projects-dir', () => {
    const fs = projectsDirFs()
    const denser = pickDensestRoot(fs.candidateRoots(), (d) => countGitReposOneLevel(d, fs))
    return denser ? { dir: denser.root, repoCount: denser.count } : null
  })
  handle('snippets:list', (_e, root?: string) =>
    listPromptSnippets(repoRootOf(root || deps.cur().cwd)),
  )
  handle('snippets:save', (_e, input: Parameters<typeof savePromptSnippet>[0]) => {
    const root = input.repoRoot ? repoRootOf(input.repoRoot) : repoRootOf(deps.cur().cwd)
    const r = savePromptSnippet({ ...input, repoRoot: root })
    if ('ok' in r) {
      emitActivity({
        kind: 'info',
        title: `Snippet saved · ${r.snippet.title}`,
        detail: input.scope === 'global' ? 'Global' : deps.repoLabelFor(root || deps.cur().cwd),
        repo: input.scope === 'repo' ? deps.repoLabelFor(root || deps.cur().cwd) : undefined,
        repoRoot: input.scope === 'repo' ? root : undefined,
        sessionId: deps.cur().sessionId,
      })
    }
    return r
  })
  handle('presets:get', () => ({
    prefs: readPresetPrefs(),
    catalog: {
      snippets: BUILT_IN_SNIPPETS.map((s) => ({ id: s.id, title: s.title, group: s.group })),
      agents: DEFAULT_AGENTS.map((a) => ({ id: a.id, title: a.title, group: 'Agents' })),
    },
  }))
  handle('presets:hide', (_e, kind: PresetKind, id: string) => hidePreset(kind, id))
  handle('presets:restore', (_e, kind: PresetKind, id?: string) => restorePreset(kind, id))
}
