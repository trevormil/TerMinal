import { useEffect, useState } from 'react'
import { Boxes, ChevronDown, ChevronRight, EyeOff, Globe, RotateCcw } from 'lucide-react'
import type { PackStatus } from '../../lib/types'

// "Daily packs" — one-click bundles of scheduled agents.
//
// This panel is intentionally thin. A pack is not a new runtime concept; the
// catalog lives in src/main/packs.ts and enabling one is seed + toggle on the
// schedules that already power everything else. What the panel buys is that the
// human doesn't have to know that "keep my repo healthy" means two specific
// agents at two specific times.
//
// It sits ABOVE the schedule list, and every pack it enables shows up in that
// list as an ordinary schedule you can retime, run now, or delete. There is no
// hidden pack state: the schedules ARE the state.

const cadence = (spec: { kind: string; hour?: number; minute?: number; expr?: string }): string => {
  if (spec.kind === 'calendar' && typeof spec.hour === 'number') {
    return `${String(spec.hour).padStart(2, '0')}:${String(spec.minute ?? 0).padStart(2, '0')}`
  }
  return spec.expr || spec.kind
}

export function DailyPacks({
  repoRoot,
  repoLabel,
  onChanged,
}: {
  repoRoot: string
  repoLabel: string
  /** Refresh the schedule list below — an enabled pack appears there. */
  onChanged: (msg: string) => void
}) {
  const [packs, setPacks] = useState<PackStatus[] | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [anyHidden, setAnyHidden] = useState(false)

  const reload = () =>
    window.gt.packs
      .status(repoRoot)
      .then((p) => {
        setPacks(p)
        // A shorter list than last time means something is hidden; offer the
        // way back rather than stranding a dismissed pack forever.
        setAnyHidden((prev) => prev || p.length === 0)
      })
      .catch(() => setPacks([]))

  useEffect(() => {
    if (repoRoot) void reload()
  }, [repoRoot])

  if (!repoRoot || !packs || packs.length === 0) {
    if (!anyHidden) return null
  }

  const toggle = async (pack: PackStatus) => {
    setBusy(pack.id)
    const r =
      pack.state === 'on'
        ? await window.gt.packs.disable(repoRoot, pack.id)
        : await window.gt.packs.enable(repoRoot, repoLabel, pack.id)
    setBusy(null)
    if (!r.ok) onChanged(r.error)
    else
      onChanged(
        pack.state === 'on'
          ? `Disabled ${pack.title}. Its schedules are kept, just paused.`
          : `Enabled ${pack.title} — ${pack.agents.length} schedule${pack.agents.length === 1 ? '' : 's'} in the list below.`,
      )
    await reload()
  }

  const hide = async (pack: PackStatus) => {
    await window.gt.packs.hide(pack.id)
    setAnyHidden(true)
    onChanged(`Hid ${pack.title}. Restore from the header.`)
    await reload()
  }

  const restoreAll = async () => {
    await window.gt.packs.restore()
    setAnyHidden(false)
    onChanged('Restored every hidden pack.')
    await reload()
  }

  return (
    <div className="rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex flex-1 cursor-pointer items-center gap-2 text-left"
        >
          {collapsed ? (
            <ChevronRight size={13} className="text-zinc-600" />
          ) : (
            <ChevronDown size={13} className="text-zinc-600" />
          )}
          <Boxes size={14} strokeWidth={2} className="text-[var(--gt-accent)]" />
          <span className="text-[12px] font-semibold text-zinc-200">Daily packs</span>
          <span className="text-[11px] text-zinc-600">
            pre-built bundles · every pack becomes ordinary schedules you can edit
          </span>
        </button>
        {anyHidden && (
          <button
            onClick={() => void restoreAll()}
            title="Restore every hidden pack"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 transition-colors duration-150 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100"
          >
            <RotateCcw size={11} /> Restore hidden
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="mt-2 space-y-1.5">
          {(packs || []).map((pack) => (
            <div
              key={pack.id}
              className="flex items-start gap-2.5 rounded-lg border border-[var(--gt-border)]/60 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] text-zinc-200">{pack.title}</span>
                  {pack.scope === 'global' && (
                    <span
                      title="Cross-repo — exactly one of these exists, however many repos you enable it from. Its home repo is wherever it was first enabled."
                      className="inline-flex items-center gap-0.5 rounded border border-[var(--gt-border)] px-1 text-[9px] text-zinc-500"
                    >
                      <Globe size={8} /> global
                    </span>
                  )}
                  {pack.state === 'partial' && (
                    <span
                      title={`${pack.enabledCount} of ${pack.agents.length} schedules enabled`}
                      className="rounded border border-amber-400/40 px-1 text-[9px] text-amber-400"
                    >
                      partial
                    </span>
                  )}
                  {pack.state !== 'off' && !pack.assetsInstalled && (
                    <span
                      title="Enabled, but this pack's agent files are missing from ~/.config/TerMinal — the schedule would fall back to a prompt with no contract on disk. Re-enable to reinstall."
                      className="rounded border border-[var(--gt-red)]/50 px-1 text-[9px] text-[var(--gt-red)]"
                    >
                      files missing
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  {pack.description}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {pack.agents.map((a) => (
                    <span
                      key={a.agentId}
                      className="rounded border border-[var(--gt-border)] px-1 py-0.5 text-[9px] text-zinc-600"
                    >
                      {a.agentId} · {cadence(a.spec)} · {a.engine}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => void toggle(pack)}
                  disabled={busy === pack.id}
                  className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 disabled:opacity-50 ${
                    pack.state === 'on'
                      ? 'border-[var(--gt-accent)]/50 bg-[var(--gt-accent)]/10 text-[var(--gt-accent-light)]'
                      : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/60 hover:text-zinc-100'
                  }`}
                >
                  {busy === pack.id ? '…' : pack.state === 'on' ? 'Enabled' : 'Enable'}
                </button>
                <button
                  onClick={() => void hide(pack)}
                  title="Hide this pack — it will stop being offered for any repo"
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-zinc-600 transition-colors duration-150 hover:bg-white/5 hover:text-zinc-300"
                >
                  <EyeOff size={11} />
                </button>
              </div>
            </div>
          ))}
          <p className="pt-0.5 text-[10px] text-zinc-600">
            Packs seed schedules disabled and then enable them, so re-enabling never overwrites a
            cadence you retimed by hand. Disabling pauses without deleting.
          </p>
        </div>
      )}
    </div>
  )
}
