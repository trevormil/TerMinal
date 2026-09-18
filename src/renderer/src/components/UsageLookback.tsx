import { useEffect, useState } from 'react'
import { usePref } from '../lib/prefs'
import { observedBurnRate, recordUsageSample, type UsageSample } from '../lib/usageLookback'

export function UsageLookback({
  kind,
  pct,
}: {
  kind: 'usage' | 'context'
  pct: number | undefined
}) {
  const [minutes, setMinutes] = usePref(kind === 'context' ? 'contextLookback' : 'usageLookback')
  const [samples, setSamples] = useState<UsageSample[]>([])
  useEffect(() => {
    const sample = () =>
      setSamples((previous) => recordUsageSample(previous, pct, Date.now(), minutes))
    sample()
    if (!minutes) return
    const timer = setInterval(sample, 30_000)
    return () => clearInterval(timer)
  }, [pct, minutes])
  const rate = minutes ? observedBurnRate(samples) : null
  return (
    <details className="mt-2 text-[11px] text-muted-foreground">
      <summary className="cursor-pointer">
        Burn rate:{' '}
        {minutes ? (rate === null ? 'collecting samples…' : `${rate.toFixed(1)} pp/hour`) : 'off'}
      </summary>
      <label className="mt-2 flex items-center gap-2">
        Lookback
        <select
          aria-label={`${kind === 'context' ? 'Context' : 'Usage'} lookback window`}
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
          className="rounded border bg-background px-2 py-1"
        >
          <option value={0}>Off</option>
          {[5, 15, 30, 60, 240].map((n) => (
            <option key={n} value={n}>
              {n < 60 ? `${n} minutes` : `${n / 60} hours`}
            </option>
          ))}
        </select>
        <button type="button" className="underline" onClick={() => setMinutes(0)}>
          Clear
        </button>
      </label>
      <p className="mt-1">
        Observed percentage points per hour while this widget is open
        {kind === 'usage' ? ', using the 5-hour quota' : ''}. Resets when usage drops. Window choice
        is saved across sessions; samples are local and temporary.
      </p>
    </details>
  )
}
