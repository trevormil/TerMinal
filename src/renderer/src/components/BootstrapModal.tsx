import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ModulesStatus } from '../lib/types'

// Sidebar grouping mirrors the Admin tab.
const GROUPS: { id: string; label: string }[] = [
  { id: 'runtime', label: 'Runtime' },
  { id: 'api-docs', label: 'API & Docs' },
  { id: 'observability', label: 'Observability' },
  { id: 'growth', label: 'Product & Growth' },
  { id: 'infra', label: 'Data & Infra' },
  { id: 'quality', label: 'Quality & Security' },
]

// Profile + module selection shown at new-project / bootstrap time. Pick a profile
// to pre-check its modules, then check/uncheck individually → seeds exactly the set.
export function BootstrapModal({
  repoRoot,
  heading,
  onDone,
  onClose,
}: {
  repoRoot: string
  heading?: string
  onDone: (seeded: string[]) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<ModulesStatus | null>(null)
  const [profile, setProfile] = useState('web-service')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.gt.modules.status(repoRoot).then((r) => {
      if ('error' in r) return
      setStatus(r)
      const p = r.profile || 'web-service'
      setProfile(p)
      // pre-check the profile's set plus anything already installed
      const seeded = r.modules.filter((m) => m.seeded).map((m) => m.id)
      setChecked(new Set([...(r.profiles[p] || []), ...seeded]))
    })
  }, [repoRoot])

  const modules = status?.modules ?? []
  const profiles = Object.keys(status?.profiles ?? { 'web-service': [] })
  const selectProfile = (p: string) => {
    setProfile(p)
    const seeded = modules.filter((m) => m.seeded).map((m) => m.id)
    setChecked(new Set([...(status?.profiles[p] ?? []), ...seeded]))
  }
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const confirm = async () => {
    setBusy(true)
    // Only seed modules not already installed.
    const installed = new Set(modules.filter((m) => m.seeded).map((m) => m.id))
    const ids = [...checked].filter((id) => !installed.has(id))
    const r = await window.gt.modules.applySelection(repoRoot, ids, profile)
    setBusy(false)
    onDone('error' in r ? [] : r.seeded)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[560px] flex-col overflow-hidden rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--gt-border)] px-4 py-3">
          <span className="text-[13px] font-semibold text-zinc-100">{heading ?? 'Set up capability modules'}</span>
          <button onClick={onClose} className="ml-auto text-zinc-600 hover:text-zinc-300">
            <X size={14} />
          </button>
        </div>

        {/* profile radios */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--gt-border)] px-4 py-2.5">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-zinc-600">Profile</span>
          {profiles.map((p) => (
            <button
              key={p}
              onClick={() => selectProfile(p)}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                profile === p
                  ? 'border-[var(--gt-accent)]/60 bg-[var(--gt-accent)]/15 text-[var(--gt-accent-light)]'
                  : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/40'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* module checklist */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!status ? (
            <div className="px-2 py-3 text-[11px] text-zinc-600">Loading modules…</div>
          ) : (
            GROUPS.map((g) => {
              const mods = modules.filter((m) => m.surface.group === g.id)
              if (!mods.length) return null
              return (
                <div key={g.id} className="mb-1.5">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-700">
                    {g.label}
                  </div>
                  {mods.map((m) => {
                    const installed = m.seeded
                    return (
                      <label
                        key={m.id}
                        className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 ${
                          installed ? 'opacity-60' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(m.id)}
                          disabled={installed}
                          onChange={() => toggle(m.id)}
                          className="mt-0.5 accent-[var(--gt-accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-[12px] text-zinc-200">
                            {m.surface.adminLabel}
                            {installed && <span className="ml-1.5 text-[9px] uppercase text-[var(--gt-green)]">installed</span>}
                            {m.scope === 'platform' && <span className="ml-1.5 text-[9px] uppercase text-[var(--gt-accent-light)]">platform</span>}
                          </span>
                          <span className="block truncate text-[10.5px] text-zinc-600">{m.summary}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--gt-border)] px-4 py-3">
          <span className="text-[11px] text-zinc-600">{[...checked].length} selected · seeded disabled</span>
          <button
            onClick={onClose}
            className="ml-auto rounded-md border border-[var(--gt-border)] px-3 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            Skip
          </button>
          <button
            onClick={confirm}
            disabled={busy || !status}
            className="rounded-md border border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 px-3 py-1 text-[11px] font-semibold text-[var(--gt-accent-light)] hover:bg-[var(--gt-accent)]/20 disabled:opacity-50"
          >
            {busy ? 'Seeding…' : 'Seed modules'}
          </button>
        </div>
      </div>
    </div>
  )
}
