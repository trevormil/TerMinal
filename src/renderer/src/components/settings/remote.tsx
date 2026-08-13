import { useState } from 'react'
import { Server } from 'lucide-react'
import type { RemoteHost, RemotePlatform } from '../../lib/types'
import { Section, actionButton, emptyDaemon, inp, type SettingsCtx, type SettingsSectionSpec } from './shared'

// The structured readiness report from `hosts:provision` (src/main/host-provision.ts).
type ProvisionState = Awaited<ReturnType<Window['gt']['provisionHost']>>
// Bun/linger/runner are what a fired timer needs to COMPLETE a run; cli is
// needed by agents that call terminal-cli. Order matches the probe's output.
const PROVISION_COMPONENTS = [
  { key: 'bun', label: 'bun', hint: 'runner interpreter' },
  { key: 'linger', label: 'linger', hint: 'fires --user timers with nobody logged in' },
  { key: 'runner', label: 'runner', hint: '~/.config/TerMinal/bin/terminal-cron' },
  { key: 'cli', label: 'cli', hint: '~/.config/TerMinal/bin/terminal-cli' },
] as const

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, save, profile, setProfile } = ctx

  const [remoteDraft, setRemoteDraft] = useState({
    label: '',
    sshTarget: '',
    defaultCwd: '',
    platform: 'linux' as RemotePlatform,
  })
  // Host provisioning (ADR-0002 #12): install bun, enable linger, install the
  // runner + cli, then report readiness. This used to be reachable ONLY as
  // `await window.gt.provisionHost(id)` in the devtools console.
  const [provision, setProvision] = useState<
    Record<string, ProvisionState | { running: true } | undefined>
  >({})
  const provisionHost = async (hostId: string) => {
    setProvision((p) => ({ ...p, [hostId]: { running: true } }))
    try {
      const r = await window.gt.provisionHost(hostId)
      setProvision((p) => ({ ...p, [hostId]: r }))
    } catch (e) {
      // Never swallow: a rejected IPC has to read as a failure, not as "idle".
      setProvision((p) => ({ ...p, [hostId]: { ok: false, error: (e as Error).message } }))
    }
  }

  const remoteId = (value: string) =>
    value
      .trim()
      .replace(/[^\w.-]/g, '-')
      .replace(/^-+|-+$/g, '')
  const saveRemoteDraft = () => {
    if (!remoteDraft.sshTarget.trim()) return
    const id = remoteId(remoteDraft.label || remoteDraft.sshTarget)
    if (!id) return
    const existing = s.remoteHosts.find((h) => h.id === id)
    const next = [
      ...s.remoteHosts.filter((h) => h.id !== id),
      {
        id,
        label: remoteDraft.label.trim() || remoteDraft.sshTarget.trim(),
        sshTarget: remoteDraft.sshTarget.trim(),
        defaultCwd: remoteDraft.defaultCwd.trim(),
        platform: remoteDraft.platform,
        daemon: existing?.daemon || emptyDaemon(),
      },
    ]
    void save({ remoteHosts: next })
    setRemoteDraft({ label: '', sshTarget: '', defaultCwd: '', platform: 'linux' })
  }
  const removeRemoteHost = (id: string) => {
    void save({ remoteHosts: s.remoteHosts.filter((h) => h.id !== id) })
  }

  return (
    <Section
      id="remote"
      icon={Server}
      title="SSH hosts"
      desc="Remote profiles for terminal sessions and daemon-backed tabs. Pick a host here, then use Daemon profile to tune its paths, engines, models, forge mode, and template repo."
    >
      <div className="space-y-3">
        {s.remoteHosts.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2">
            {s.remoteHosts.map((h: RemoteHost) => (
              <div
                key={h.id}
                className={`rounded-lg border p-3 ${
                  profile === h.id
                    ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10'
                    : 'border-[var(--gt-border)] bg-black/20'
                }`}
              >
                <div className="mb-2 flex items-start gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/25 text-[var(--gt-accent-2)]">
                    <Server size={14} strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-zinc-100">
                      {h.label}
                    </div>
                    <div className="truncate font-mono text-[10.5px] text-zinc-600">
                      {h.sshTarget}
                    </div>
                  </div>
                  <span className="rounded border border-[var(--gt-border)] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-zinc-500">
                    {h.platform}
                  </span>
                </div>
                <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-md bg-black/20 px-2 py-1.5 text-[10.5px]">
                  <span className="text-zinc-600">cwd</span>
                  <span className="truncate font-mono text-zinc-400">
                    {h.defaultCwd || h.daemon.projectsDir || '~'}
                  </span>
                  <span className="text-zinc-600">id</span>
                  <span className="truncate font-mono text-zinc-500">{h.id}</span>
                </div>
                {/* Provision — install bun + linger + runner + cli and
                    report readiness. Linux only: the systemd timer
                    layer is Linux-specific (ADR-0002). */}
                {h.platform !== 'macos' &&
                  (() => {
                    const p = provision[h.id]
                    const running = !!p && 'running' in p
                    const r = p && !('running' in p) ? p : null
                    return (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void provisionHost(h.id)}
                            disabled={running}
                            className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-300 hover:border-[var(--gt-accent)]/50 hover:text-zinc-100 disabled:opacity-50"
                            title="Install Bun, enable systemd linger, install the cron runner + terminal-cli, then probe readiness"
                          >
                            {running ? 'Provisioning…' : 'Provision'}
                          </button>
                          {running && (
                            <span className="text-[10.5px] text-zinc-500">
                              installing over SSH — can take a couple of minutes
                            </span>
                          )}
                          {r && (
                            <span
                              className={`text-[10.5px] font-semibold ${
                                r.ready ? 'text-[var(--gt-green)]' : 'text-amber-400'
                              }`}
                            >
                              {r.ready
                                ? 'ready to run scheduled agents'
                                : `not ready — missing ${(r.missing || []).join(', ') || 'unknown'}`}
                            </span>
                          )}
                        </div>
                        {r?.error && (
                          <div className="rounded-md border border-[var(--gt-red)]/50 bg-[var(--gt-red)]/10 px-2 py-1 text-[10.5px] text-[var(--gt-red)]">
                            {r.error}
                          </div>
                        )}
                        {r && !r.error && (
                          <div className="space-y-1 rounded-md bg-black/20 px-2 py-1.5">
                            <div className="flex flex-wrap gap-1.5">
                              {PROVISION_COMPONENTS.map((c) => {
                                const ok = c.key === 'bun' ? !!r.bun : !!r[c.key]
                                return (
                                  <span
                                    key={c.key}
                                    title={c.hint}
                                    className={`rounded border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide ${
                                      ok
                                        ? 'border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 text-[var(--gt-green)]'
                                        : 'border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 text-[var(--gt-red)]'
                                    }`}
                                  >
                                    {c.label} {ok ? 'ok' : 'missing'}
                                    {c.key === 'bun' && r.bun ? ` ${r.bun}` : ''}
                                  </span>
                                )
                              })}
                              {Object.entries(r.engines || {}).map(([e, ok]) => (
                                <span
                                  key={e}
                                  title="Engine binary on the host PATH (login shell). Not a login/auth check."
                                  className={`rounded border px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide ${
                                    ok
                                      ? 'border-[var(--gt-border)] text-zinc-400'
                                      : 'border-[var(--gt-border)] text-zinc-600'
                                  }`}
                                >
                                  {e} {ok ? 'found' : 'absent'}
                                </span>
                              ))}
                            </div>
                            {r.log && (
                              <details>
                                <summary className="cursor-pointer text-[10px] text-zinc-600 hover:text-zinc-400">
                                  provision log
                                </summary>
                                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-500">
                                  {r.log}
                                </pre>
                              </details>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                <div className="mt-2 flex items-center gap-1">
                  <button
                    onClick={() => setProfile(h.id)}
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-100"
                  >
                    Use profile
                  </button>
                  <button
                    onClick={() =>
                      setRemoteDraft({
                        label: h.label,
                        sshTarget: h.sshTarget,
                        defaultCwd: h.defaultCwd,
                        platform: h.platform,
                      })
                    }
                    className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-100"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeRemoteHost(h.id)}
                    className="ml-auto rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-500 hover:border-[var(--gt-red)]/50 hover:text-[var(--gt-red)]"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--gt-border)] p-3 text-[11px] text-zinc-600">
            No remote hosts yet. Add one with an SSH config alias like{' '}
            <span className="font-mono">tm</span> or a target like{' '}
            <span className="font-mono">user@example.com</span>.
          </div>
        )}
        <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold text-zinc-200">Add or update host</div>
              <div className="text-[10.5px] text-zinc-600">
                Using the same label replaces an existing profile.
              </div>
            </div>
            <button
              onClick={saveRemoteDraft}
              disabled={!remoteDraft.sshTarget.trim()}
              className={actionButton}
            >
              Save host
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Label
              </span>
              <input
                value={remoteDraft.label}
                onChange={(e) => setRemoteDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Remote desktop"
                className={`${inp} font-mono`}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                SSH target
              </span>
              <input
                value={remoteDraft.sshTarget}
                onChange={(e) => setRemoteDraft((d) => ({ ...d, sshTarget: e.target.value }))}
                placeholder="tm or user@example.com"
                spellCheck={false}
                className={`${inp} font-mono`}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Default cwd
              </span>
              <input
                value={remoteDraft.defaultCwd}
                onChange={(e) => setRemoteDraft((d) => ({ ...d, defaultCwd: e.target.value }))}
                placeholder="~"
                spellCheck={false}
                className={`${inp} font-mono`}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Platform
              </span>
              <select
                value={remoteDraft.platform}
                onChange={(e) =>
                  setRemoteDraft((d) => ({ ...d, platform: e.target.value as RemotePlatform }))
                }
                className="h-[33px] w-full rounded-md border border-[var(--gt-border)] bg-black/30 px-2 py-1 text-[12px] text-zinc-200 outline-none"
              >
                <option value="linux" className="bg-[var(--gt-panel)]">
                  Linux
                </option>
                <option value="macos" className="bg-[var(--gt-panel)]">
                  macOS
                </option>
                <option value="auto" className="bg-[var(--gt-panel)]">
                  Auto
                </option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'remote',
  title: 'SSH Hosts',
  icon: Server,
  order: 4,
  Component,
}
export default section
