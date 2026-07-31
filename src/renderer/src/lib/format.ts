export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

/**
 * Run cost. Sub-cent runs are the common case, so precision widens as the
 * number shrinks; an unpriced run reads as an em dash, never as "$0.00".
 */
export function fmtUsd(n: number): string {
  if (n >= 10) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(3).replace(/0$/, '')}`
  if (n > 0) return `$${n.toFixed(4)}`
  return '—'
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}
