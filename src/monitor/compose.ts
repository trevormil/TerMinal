// Human, email-like notification copy.
//
// "status.example.com is down — the uptime check returned HTTP 503" reads like
// mail; "Monitor fail · status / HTTP 503" reads like a log line. The inbox is
// where you triage from your phone, so it gets the friendly version.
import { categoryLabel } from '../shared/monitor-flap'
import type { MonitorState, ProbeResult, StoredMonitor } from './types'

export const KIND: Record<string, string> = {
  http: 'uptime check',
  'tls-cert': 'TLS certificate',
  tcp: 'port check',
  dns: 'DNS lookup',
  command: 'health check',
}

export function humanSince(since: number, now: number): string {
  const s = Math.max(0, Math.round((now - since) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`
  return `${Math.round(s / 86400)} days ago`
}

export function compose(
  m: StoredMonitor,
  prevStatus: MonitorState,
  next: MonitorState,
  res: ProbeResult,
  now: number,
  since: number,
  consecutive = 0,
): { title: string; body: string } {
  const kind = KIND[String(m.type)] || 'check'
  const summary = (res.summary || '').trim()
  // The concrete thing being watched — a URL/host for network checks; a command
  // has no meaningful target to show.
  const where = m.target && m.type !== 'command' ? ` at ${m.target}` : ''

  if (next === 'ok') {
    const wasWord = prevStatus === 'fail' ? 'failing' : 'degraded'
    return {
      title: `✅ ${m.name} recovered`,
      body:
        `Good news — ${m.name} is healthy again after ${wasWord}. ` +
        `Its ${kind}${where} is passing once more${summary ? ` (${summary})` : ''}.`,
    }
  }

  // Type-aware subject so a cert warning doesn't read as "is down".
  let title: string
  if (m.type === 'tls-cert') {
    title =
      next === 'fail' ? `🔴 ${m.name} certificate problem` : `🟡 ${m.name} certificate expiring`
  } else if (m.type === 'command') {
    title = next === 'fail' ? `🔴 ${m.name} check failed` : `🟡 ${m.name} check degraded`
  } else {
    title = next === 'fail' ? `🔴 ${m.name} is down` : `🟡 ${m.name} is degraded`
  }

  const priorLine =
    prevStatus === 'ok'
      ? 'It was healthy on the previous check.'
      : `It had already been ${prevStatus} before this.`
  const verb = next === 'fail' ? 'started failing' : 'started reporting problems'
  // WHICH kind of failure, in the alert itself: "their end: HTTP 500" and
  // "no network path to the host" call for completely different reactions, and
  // the old copy rendered both as "is down".
  const kindLine = res.category ? `Failure kind — ${categoryLabel(res.category)}. ` : ''
  const runsLine =
    consecutive > 1 ? `Confirmed over ${consecutive} consecutive failed checks. ` : ''
  return {
    title,
    body:
      `${m.name}'s ${kind}${where} ${verb} ${humanSince(since, now)}. ` +
      `${summary ? `What we saw: ${summary}. ` : ''}${kindLine}${runsLine}${priorLine}`,
  }
}
