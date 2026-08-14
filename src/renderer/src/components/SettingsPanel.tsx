import { useEffect, useState } from 'react'
import { Loader2, Settings as SettingsIcon, X } from 'lucide-react'
import type {
  DaemonCfg,
  Engine,
  EnvDetect,
  RemoteHost,
  RemoteSettingsProbe,
  Settings,
  SettingsPatch,
} from '../lib/types'
import { SETTINGS_SECTIONS } from './settings/registry'
import {
  ActiveSectionContext,
  daemonFromSettings,
  emptyDaemon,
  mergeDaemon,
  type SettingsCtx,
} from './settings/shared'

/**
 * The Settings modal shell: owns the state every section reads/writes
 * through `SettingsCtx` (current settings, the daemon-profile selection, and
 * the handful of mutators shared across sections), the nav rail, and the
 * section-routing/scroll chrome. Each category itself — the ~24
 * `<Section id="...">` panes — lives in `./settings/<id>.tsx` and is
 * discovered via `SETTINGS_SECTIONS` (import.meta.glob, same pattern as
 * `tabs/registry.ts`).
 */
export function SettingsPanel({
  onClose,
  onRerunSetup,
  initialSection,
}: {
  onClose: () => void
  onRerunSetup: () => void
  /** Category to open on — set when something deep-links into settings. */
  initialSection?: string
}) {
  const [active, setActive] = useState(
    initialSection && SETTINGS_SECTIONS.some((n) => n.id === initialSection)
      ? initialSection
      : 'daemon',
  )
  const [s, setS] = useState<Settings | null>(null)
  const [env, setEnv] = useState<EnvDetect | null>(null)
  const [profile, setProfile] = useState('local')
  const [remoteProbe, setRemoteProbe] = useState<
    Record<string, RemoteSettingsProbe | { loading: true }>
  >({})

  useEffect(() => {
    void window.gt.settings.get().then(setS)
    void window.gt.detectEnv().then(setEnv)
  }, [])
  useEffect(() => {
    if (s && profile !== 'local' && !s.remoteHosts.some((h) => h.id === profile))
      setProfile('local')
  }, [s, profile])

  const save = async (patch: SettingsPatch) => {
    const next = await window.gt.settings.patch(patch)
    setS(next)
    window.dispatchEvent(new CustomEvent('gt.settings.changed', { detail: next }))
  }

  useEffect(() => {
    if (!s || profile === 'local') return
    const host = s.remoteHosts.find((h) => h.id === profile)
    if (!host || remoteProbe[host.id]) return
    setRemoteProbe((cur) => ({ ...cur, [host.id]: { loading: true } }))
    void window.gt.settings
      .remoteProbe(host.id)
      .then((probe) => setRemoteProbe((cur) => ({ ...cur, [host.id]: probe })))
  }, [s, profile, remoteProbe])
  const selectedHost: RemoteHost | null = s?.remoteHosts.find((h) => h.id === profile) || null
  const selectedDaemon: DaemonCfg = s
    ? selectedHost
      ? selectedHost.daemon
      : daemonFromSettings(s)
    : emptyDaemon()
  const selectedProbe = selectedHost ? remoteProbe[selectedHost.id] || null : null
  const selectedIsRemote = !!selectedHost
  const saveDaemon = async (
    patch: Partial<Omit<DaemonCfg, 'engines'>> & {
      engines?: Partial<Record<Engine, Partial<DaemonCfg['engines'][Engine]>>>
    },
  ) => {
    if (!s) return
    if (!selectedHost) {
      const next = mergeDaemon(daemonFromSettings(s), patch)
      await save({
        projectsDir: next.projectsDir,
        worktreesDir: next.worktreesDir,
        harnessDir: next.harnessDir,
        templateRepo: next.templateRepo,
        engines: next.engines,
        defaultEngine: next.defaultEngine,
        forge: next.forge,
      })
      return
    }
    const hosts = s.remoteHosts.map((h) =>
      h.id === selectedHost.id
        ? { ...h, daemon: mergeDaemon(h.daemon || emptyDaemon(), patch) }
        : h,
    )
    await save({ remoteHosts: hosts })
  }
  const refreshRemoteProbe = (host: RemoteHost) => {
    setRemoteProbe((cur) => ({ ...cur, [host.id]: { loading: true } }))
    void window.gt.settings
      .remoteProbe(host.id)
      .then((probe) => setRemoteProbe((cur) => ({ ...cur, [host.id]: probe })))
  }

  if (!s)
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
        <Loader2 className="animate-spin text-zinc-500" />
      </div>
    )

  const ctx: SettingsCtx = {
    s,
    env,
    save,
    profile,
    setProfile,
    selectedHost,
    selectedDaemon,
    selectedProbe,
    selectedIsRemote,
    saveDaemon,
    refreshRemoteProbe,
    onRerunSetup,
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[min(860px,calc(100vh-32px))] w-[min(1080px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-[var(--gt-border)] bg-[var(--gt-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--gt-border)] bg-[var(--gt-panel)]/80 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--gt-border)] bg-black/30 text-[var(--gt-accent-light)]">
            <SettingsIcon size={16} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-zinc-100">
              Settings
              <span className="text-zinc-600"> · </span>
              <span className="font-normal text-zinc-400">
                {SETTINGS_SECTIONS.find((n) => n.id === active)?.title}
              </span>
            </h2>
            {/* Which daemon every pane below reads from — the one piece of
                context that has to survive switching categories. */}
            <div className="mt-0.5 truncate text-[10.5px] text-zinc-500">
              {selectedHost ? `SSH · ${selectedHost.label}` : 'Local daemon'}
            </div>
          </div>
          <div
            className="mr-2 shrink-0 text-right font-mono text-[9.5px] leading-tight text-zinc-600"
            title={`Installed build — v${__APP_VERSION__}, commit ${__BUILD_SHA__} on ${__BUILD_BRANCH__}, built ${__BUILD_TIME__}`}
          >
            <div className="text-zinc-400">
              v{__APP_VERSION__} · {__BUILD_SHA__}
            </div>
            <div>{__BUILD_TIME__.slice(0, 16).replace('T', ' ')}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden min-h-0 w-52 shrink-0 overflow-y-auto border-r border-[var(--gt-border)] bg-[var(--gt-panel)]/35 p-3 md:block">
            <div className="mb-2 px-2 text-[9.5px] font-bold uppercase tracking-[0.16em] text-zinc-600">
              Categories
            </div>
            <nav className="space-y-0.5">
              {SETTINGS_SECTIONS.map(({ id, title, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActive(id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors ${
                    active === id
                      ? 'bg-[var(--gt-accent)]/20 text-[var(--gt-accent-light)]'
                      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
                  }`}
                >
                  <Icon
                    size={13}
                    strokeWidth={2}
                    className={active === id ? 'text-[var(--gt-accent-light)]' : 'text-zinc-600'}
                  />
                  <span>{title}</span>
                </button>
              ))}
            </nav>
            <div className="mt-4 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2 text-[10.5px] leading-relaxed text-zinc-600">
              User-owned config lives in{' '}
              <span className="font-mono text-zinc-500">~/.config/TerMinal</span> and survives app
              updates.
            </div>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ActiveSectionContext.Provider value={active}>
              <div className="mx-auto max-w-[760px] space-y-3">
                {SETTINGS_SECTIONS.map(({ id, Component }) => (
                  <Component key={id} ctx={ctx} />
                ))}
                <div className="px-5 py-3 text-center text-[10.5px] text-zinc-600">
                  TerMinal · settings stored in ~/.config/TerMinal/settings.json
                </div>
              </div>
            </ActiveSectionContext.Provider>
          </div>
        </div>
      </div>
    </div>
  )
}
