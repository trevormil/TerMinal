import { useEffect, useState } from 'react'
import { Loader2, PackageOpen, RotateCcw } from 'lucide-react'
import { Section, type SettingsSectionSpec } from './shared'

// In-app rebuild panel. Kicks off bin/release as a detached daemon, tails the
// log live in the UI, and prepares the user for the imminent app quit. The
// release script kills the running TerMinal halfway through to replace
// /Applications — that's expected, and the relaunch is the script's job.
function RebuildPanel() {
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Tail the log every second while a rebuild is going. We also keep polling
  // status:running so the indicator clears once bin/release finishes (in
  // practice the app gets quit + relaunched, so this UI is mostly seen for
  // the "build…" phase before the kill lands).
  useEffect(() => {
    if (!running) return
    let alive = true
    const tick = async () => {
      const text = await window.gt.release.tail()
      const st = await window.gt.release.status()
      if (!alive) return
      setLog(text)
      if (!st.running) setRunning(false)
    }
    void tick()
    const id = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [running])

  const start = async () => {
    setError(null)
    setBusy(true)
    const r = await window.gt.release.start()
    setBusy(false)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setRunning(true)
  }

  return (
    <div className="space-y-2">
      <button
        onClick={start}
        disabled={busy || running}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-3 py-2 text-left text-[12px] text-zinc-100 hover:bg-[var(--gt-accent)]/20 disabled:opacity-50"
      >
        {busy || running ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RotateCcw size={14} strokeWidth={2} />
        )}
        {running
          ? 'Rebuilding… (app will quit + relaunch automatically)'
          : 'Rebuild + reinstall now'}
        <span className="ml-auto text-[10.5px] text-zinc-600">bun run release</span>
      </button>
      {error && <div className="text-[11px] text-amber-400">{error}</div>}
      {(running || log) && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--gt-border)] bg-[var(--gt-code-bg)] p-2 font-mono text-[10.5px] leading-relaxed text-[var(--gt-text-soft)]">
          {log || '(starting…)'}
        </pre>
      )}
      <div className="text-[10.5px] leading-4 text-zinc-600">
        Checks origin first and fast-forwards clean main/master checkouts before building. Reinstall
        replaces only the app bundle and TerMinal-owned helper binaries. Settings, custom agents,
        scripts, snippets, widgets, schedules, inbox, and run state in
        <span className="font-mono"> ~/.config/TerMinal</span> are preserved.
      </div>
    </div>
  )
}

function Component() {
  return (
    <Section
      id="rebuild"
      icon={PackageOpen}
      title="Rebuild + reinstall"
      desc="Run bin/release from inside the app — fetches latest when safe, builds, signs, replaces the installed app, relaunches. Source checkout must be on this machine."
    >
      <RebuildPanel />
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'rebuild',
  title: 'Rebuild',
  icon: PackageOpen,
  order: 23,
  Component,
}
export default section
