import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  MinusCircle,
  CircleDashed,
  type LucideIcon,
} from 'lucide-react'
import type { BadgeTone } from '../../components/ui'
import type { CiRunStatus } from '../../lib/types'
import type { CiSpan } from '../../lib/ciLogFormat'
import { relativeTime } from '../../lib/time'

// Shared presentation helpers for the native CI "Runs" view: status → icon/
// tone, duration + relative-time formatting, and the ANSI-span → GT-colour
// mapping the log viewer renders through.

export type StatusMeta = { Icon: LucideIcon; tone: BadgeTone; spin?: boolean; color: string }

export function statusMeta(status: CiRunStatus): StatusMeta {
  switch (status) {
    case 'success':
      return { Icon: CheckCircle2, tone: 'green', color: 'var(--gt-green)' }
    case 'failed':
      return { Icon: XCircle, tone: 'red', color: 'var(--gt-red)' }
    case 'in_progress':
      return { Icon: Loader2, tone: 'blue', spin: true, color: 'var(--gt-blue)' }
    case 'queued':
    case 'pending':
      return { Icon: Clock, tone: 'yellow', color: 'var(--gt-yellow)' }
    case 'canceled':
    case 'skipped':
    default:
      return {
        Icon: status === 'skipped' ? CircleDashed : MinusCircle,
        tone: 'mute',
        color: '#71717a',
      }
  }
}

/** Small status glyph used in run/job/step rows. */
export function StatusIcon({ status, size = 13 }: { status: CiRunStatus; size?: number }) {
  const { Icon, spin, color } = statusMeta(status)
  return (
    <Icon
      size={size}
      strokeWidth={2.25}
      className={`shrink-0 ${spin ? 'animate-spin' : ''}`}
      style={{ color }}
    />
  )
}

export function isActive(status: CiRunStatus): boolean {
  return status === 'in_progress' || status === 'queued' || status === 'pending'
}

/** ms → "1m 20s" / "45s" / "1h 3m". */
export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

/** epoch-ms → "5m ago". */
export function reltime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  // A CI timestamp ahead of our clock reads as 'just now', not '0s ago'.
  if (ms > Date.now()) return 'just now'
  return relativeTime(ms)
}

/** Map a parsed log span's fg name to a GT colour; undefined = inherit (zinc-300). */
export function spanColor(fg?: string): string | undefined {
  switch (fg) {
    case 'red':
      return 'var(--gt-red)'
    case 'green':
      return 'var(--gt-green)'
    case 'yellow':
      return 'var(--gt-yellow)'
    case 'blue':
    case 'cyan':
      return 'var(--gt-accent-light)'
    case 'gray':
      return '#52525b'
    default:
      return undefined
  }
}

export function spanStyle(span: CiSpan): React.CSSProperties {
  return {
    color: spanColor(span.fg),
    fontWeight: span.bold ? 600 : undefined,
    opacity: span.dim ? 0.6 : undefined,
  }
}
