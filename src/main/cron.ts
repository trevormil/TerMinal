// Pure cron / schedule helpers — no Electron, no fs. Translates a schedule's
// timing spec (structured or a raw 5-field cron expression) into a launchd
// trigger, plus human description + next-fire computation for the UI.

export type CalendarDict = {
  Minute?: number
  Hour?: number
  Day?: number
  Weekday?: number
  Month?: number
}
export type LaunchdTrigger =
  | { kind: 'interval'; seconds: number }
  | { kind: 'calendar'; entries: CalendarDict[] }

// Stored timing spec. `interval` → StartInterval; `calendar` → one or more
// StartCalendarInterval dicts; `cron` → a raw expression parsed to either.
export type ScheduleSpec =
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'calendar'; minute: number; hour: number; weekdays?: number[] }
  | { kind: 'cron'; expr: string }

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CALENDAR_ENTRIES = 500 // guard against expansion blow-ups

// Expand one cron field to its concrete values, or null for "*" (any).
// Supports: *, N, A-B, A-B/S, */S, and comma lists of those.
function parseField(field: string, min: number, max: number): number[] | null {
  if (field === '*') return null
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/)
    if (!m) throw new Error(`bad cron field: "${part}"`)
    const [, range, stepRaw] = m
    const step = stepRaw ? Number(stepRaw) : 1
    if (step < 1) throw new Error(`bad step in "${part}"`)
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      lo = a
      hi = b
    } else {
      lo = hi = Number(range)
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron value out of range: "${part}"`)
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

// Parse a 5-field cron expression (min hour dom month dow) → a launchd trigger.
export function cronToTrigger(expr: string): LaunchdTrigger {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('cron must have 5 fields: min hour dom month dow')
  const [minF, hourF, domF, monF, dowF] = fields

  // Pure interval fast-path: "*/N * * * *" or "* * * * *".
  const everyMin = minF.match(/^\*\/(\d+)$/)
  if ((everyMin || minF === '*') && hourF === '*' && domF === '*' && monF === '*' && dowF === '*') {
    const n = everyMin ? Number(everyMin[1]) : 1
    return { kind: 'interval', seconds: Math.max(60, n * 60) }
  }

  const minutes = parseField(minF, 0, 59)
  const hours = parseField(hourF, 0, 23)
  const days = parseField(domF, 1, 31)
  const months = parseField(monF, 1, 12)
  // cron dow: 0 or 7 = Sunday → normalize 7→0
  const dows = parseField(dowF, 0, 7)?.map((d) => (d === 7 ? 0 : d))
  const dowsUniq = dows ? [...new Set(dows)] : null

  // Cartesian product → calendar dicts (omit "*" fields).
  const mins = minutes ?? [null]
  const hrs = hours ?? [null]
  const dys = days ?? [null]
  const mons = months ?? [null]
  const wds = dowsUniq ?? [null]
  const entries: CalendarDict[] = []
  for (const M of mons)
    for (const d of dys)
      for (const w of wds)
        for (const h of hrs)
          for (const mm of mins) {
            const e: CalendarDict = {}
            if (mm !== null) e.Minute = mm
            if (h !== null) e.Hour = h
            if (d !== null) e.Day = d
            if (w !== null) e.Weekday = w
            if (M !== null) e.Month = M
            entries.push(e)
            if (entries.length > MAX_CALENDAR_ENTRIES)
              throw new Error('cron expands to too many entries — use an interval instead')
          }
  return { kind: 'calendar', entries }
}

export function specToTrigger(spec: ScheduleSpec): LaunchdTrigger {
  if (spec.kind === 'interval') return { kind: 'interval', seconds: Math.max(60, spec.everyMinutes * 60) }
  if (spec.kind === 'cron') return cronToTrigger(spec.expr)
  // calendar
  if (spec.weekdays && spec.weekdays.length)
    return {
      kind: 'calendar',
      entries: spec.weekdays.map((w) => ({ Minute: spec.minute, Hour: spec.hour, Weekday: w })),
    }
  return { kind: 'calendar', entries: [{ Minute: spec.minute, Hour: spec.hour }] }
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

export function describeSpec(spec: ScheduleSpec): string {
  if (spec.kind === 'interval') {
    const n = spec.everyMinutes
    if (n % 60 === 0) return `every ${n / 60}h`
    return `every ${n}m`
  }
  if (spec.kind === 'cron') return `cron: ${spec.expr}`
  const at = hhmm(spec.hour, spec.minute)
  if (!spec.weekdays || spec.weekdays.length === 0 || spec.weekdays.length === 7) return `daily at ${at}`
  const days = [...spec.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d])
  return `${days.join(',')} at ${at}`
}

// Next fire time (ms) for display. Interval is anchored to `from` (launchd's
// StartInterval is load-relative, so this is approximate); calendar/cron are
// computed exactly by scanning minute-by-minute up to a year out.
export function nextRun(spec: ScheduleSpec, from = Date.now(), lastRun?: number): number | null {
  const trig = specToTrigger(spec)
  if (trig.kind === 'interval') {
    // launchd StartInterval fires every N seconds relative to the LAST fire, so
    // the real next fire is lastRun + interval — not from + interval. Anchoring
    // to `from` was the bug: every reload recomputed now+interval, so the
    // countdown never ticked down and the absolute "next" time drifted forward.
    // Before the first run we have no anchor and fall back to from + interval.
    // When lastRun + interval is already past (missed/coalesced fires while
    // asleep), the result is in the past and the UI honestly reads "now".
    return (lastRun ?? from) + trig.seconds * 1000
  }
  const matches = (d: Date): boolean =>
    trig.entries.some(
      (e) =>
        (e.Minute === undefined || e.Minute === d.getMinutes()) &&
        (e.Hour === undefined || e.Hour === d.getHours()) &&
        (e.Day === undefined || e.Day === d.getDate()) &&
        (e.Weekday === undefined || e.Weekday === d.getDay()) &&
        (e.Month === undefined || e.Month === d.getMonth() + 1),
    )
  // start at the next whole minute
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matches(d)) return d.getTime()
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}
