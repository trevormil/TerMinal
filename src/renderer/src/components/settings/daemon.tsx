import { Loader2, Monitor, RotateCcw, Server } from 'lucide-react'
import { Section, buttonSoft, type SettingsCtx, type SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { s, profile, setProfile, selectedHost, selectedProbe, refreshRemoteProbe } = ctx
  return (
    <Section
      id="daemon"
      icon={Server}
      title="Daemon profile"
      desc="Choose where TerMinal reads paths, engines, models, forge settings, and template defaults."
      actions={
        <>
          <span className="rounded-md border border-[var(--gt-border)] bg-black/25 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
            {selectedHost ? 'SSH' : 'Local'}
          </span>
          {selectedHost && (
            <button onClick={() => refreshRemoteProbe(selectedHost)} className={buttonSoft}>
              {selectedProbe && 'loading' in selectedProbe ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              Probe
            </button>
          )}
        </>
      }
    >
      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => setProfile('local')}
            className={`flex min-h-[58px] items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
              profile === 'local'
                ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
                : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
            }`}
          >
            <Monitor size={16} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-light)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold">Local machine</span>
              <span className="block truncate text-[10.5px] text-zinc-600">
                this Mac · ~/.config/TerMinal
              </span>
            </span>
            {profile === 'local' && (
              <span className="rounded bg-[var(--gt-accent)]/20 px-1.5 py-0.5 text-[9.5px] text-[var(--gt-accent-light)]">
                Active
              </span>
            )}
          </button>
          {s.remoteHosts.map((h) => (
            <button
              key={h.id}
              onClick={() => setProfile(h.id)}
              className={`flex min-h-[58px] items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                profile === h.id
                  ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
                  : 'border-[var(--gt-border)] bg-black/20 text-zinc-400 hover:border-[var(--gt-accent)]/50 hover:text-zinc-200'
              }`}
            >
              <Server size={16} strokeWidth={2} className="shrink-0 text-[var(--gt-accent-2)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">
                  {h.label || h.id}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-zinc-600">
                  {h.sshTarget}
                </span>
              </span>
              {profile === h.id && (
                <span className="rounded bg-[var(--gt-accent)]/20 px-1.5 py-0.5 text-[9.5px] text-[var(--gt-accent-light)]">
                  Active
                </span>
              )}
            </button>
          ))}
        </div>
        {selectedHost && selectedProbe && !('loading' in selectedProbe) && (
          <div
            className={`rounded-md border px-2.5 py-1.5 text-[10.5px] ${selectedProbe.ok ? 'border-[var(--gt-border)] bg-black/20 text-zinc-500' : 'border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 text-amber-400'}`}
          >
            {selectedProbe.ok
              ? `Connected to ${selectedHost.sshTarget} · cwd ${selectedProbe.cwd || '~'} · ${Object.values(selectedProbe.engines).filter(Boolean).length}/3 engines detected`
              : selectedProbe.error}
          </div>
        )}
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'daemon',
  title: 'Daemon',
  icon: Server,
  order: 0,
  Component,
}
export default section
