import { usePref } from '../lib/prefs'
import { exceedsSoftCap } from '../lib/usageSoftCap'

export function UsageSoftCap({
  kind,
  pct,
}: {
  kind: 'context' | 'usage'
  pct: number | undefined
}) {
  const [cap, setCap] = usePref(kind === 'context' ? 'contextSoftCap' : 'usageSoftCap')
  return (
    <div className="mt-2 text-[11px]">
      {exceedsSoftCap(pct, cap) && (
        <p role="status" className="mb-1 text-[var(--gt-yellow)]">
          {kind === 'context' ? 'Context' : 'Usage'} reached your {cap}% soft cap. You can keep
          working.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-muted-foreground">
          Soft cap: {cap ? `${cap}%` : 'off'}
        </summary>
        <label className="mt-2 flex items-center gap-2 text-muted-foreground">
          Warn at %
          <input
            aria-label={`${kind === 'context' ? 'Context' : 'Usage'} soft cap percentage`}
            type="number"
            min="0.1"
            max="100"
            step="any"
            placeholder="Off"
            value={cap || ''}
            onChange={(e) => {
              if (!e.target.value) setCap(0)
              else if (e.target.validity.valid) setCap(Number(e.target.value))
            }}
            className="w-20 rounded border bg-background px-2 py-1 text-foreground"
          />
          <button type="button" onClick={() => setCap(0)} className="underline">
            Clear
          </button>
        </label>
        <p className="mt-1 text-muted-foreground">
          Optional warning only. Applies to this widget across sessions.
        </p>
      </details>
    </div>
  )
}
