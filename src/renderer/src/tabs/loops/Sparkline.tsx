// Taste-score trend for one loop.
//
// Single series, so no legend — the heading names it. Only the last point is
// direct-labelled (a number on every point is noise), and because the y-domain
// is fitted to the data rather than anchored at zero, the min/max are printed on
// the axis so a small real change can't read as a dramatic one.

type Props = {
  values: number[]
  width?: number
  height?: number
  /** Rendered under each point as a tooltip, e.g. the turn number. */
  labels?: string[]
}

export function Sparkline({ values, width = 320, height = 56, labels }: Props) {
  if (values.length === 0) return null

  const pad = 6
  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat series would divide by zero; give it a centred line instead.
  const span = max - min || 1
  const innerW = width - pad * 2
  const innerH = height - pad * 2

  const x = (i: number) =>
    values.length === 1 ? pad + innerW / 2 : pad + (i / (values.length - 1)) * innerW
  const y = (v: number) => pad + innerH - ((v - min) / span) * innerH

  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ')
  const last = values.length - 1

  return (
    <div className="flex items-end gap-3">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Taste score trend across ${values.length} scored turns, from ${min} to ${max}`}
        className="overflow-visible"
      >
        {/* recessive baseline */}
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="var(--gt-border)"
          strokeWidth={1}
        />
        <path
          d={d}
          fill="none"
          stroke="var(--gt-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {values.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={i === last ? 3.5 : 2}
            fill={i === last ? 'var(--gt-accent)' : 'var(--gt-bg)'}
            stroke="var(--gt-accent)"
            strokeWidth={1.5}
          >
            <title>{`${labels?.[i] ?? `turn ${i + 1}`}: ${v}`}</title>
          </circle>
        ))}
      </svg>
      <div className="shrink-0 pb-1 font-mono text-[10px] leading-tight text-zinc-600">
        <div className="text-[13px] font-semibold text-[var(--gt-accent-light)]">
          {values[last]}
        </div>
        <div>max {max}</div>
        <div>min {min}</div>
      </div>
    </div>
  )
}
