// The ctrl+Tab switcher HUD: an in-app cmd+Tab. Hold ctrl, tap Tab to step
// through sessions in most-recently-used order, release ctrl to commit. Pure
// presentation — App.tsx owns the key handling and the MRU order.
export type SwitcherEntry = {
  key: string
  title: string
  sub: string
  status?: string
}

const DOT: Record<string, string> = {
  working: 'bg-[var(--gt-green)]',
  awaiting: 'bg-[var(--gt-accent2)]',
  idle: 'bg-[var(--gt-yellow)]',
  error: 'bg-[var(--gt-red)]',
}

export function SessionSwitcher({ entries, index }: { entries: SwitcherEntry[]; index: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center">
      <div className="max-h-[60%] w-[420px] overflow-y-auto rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)]/95 p-2 shadow-2xl backdrop-blur">
        <div className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
          Sessions — release ⌃ to switch
        </div>
        {entries.map((s, i) => (
          <div
            key={s.key}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 ${
              i === index ? 'bg-[var(--gt-accent)]/20' : ''
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.status || ''] || 'bg-zinc-700'}`}
            />
            <span
              className={`min-w-0 flex-1 truncate text-[12.5px] ${
                i === index ? 'font-semibold text-zinc-100' : 'text-zinc-400'
              }`}
            >
              {s.title}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-zinc-600">{s.sub}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
