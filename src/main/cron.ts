// Pure cron / schedule helpers — no Electron, no fs. Translates a schedule's
// timing spec (structured or a raw 5-field cron expression) into a launchd
// trigger, plus human description + prev/next-fire computation for the UI.
//
// Every schedule fires at specific wall-clock times via launchd
// StartCalendarInterval. There is deliberately NO interval/StartInterval path:
// StartInterval fires relative to when the job was loaded, drifts on every app
// relaunch, and coalesces missed fires while the Mac sleeps — the opposite of a
// predictable cron. `*/N` in a cron field is still fine; it expands to concrete
// calendar minutes (0, N, 2N, …), which fire at the same wall-clock time daily.

export type CalendarDict = {
  Minute?: number
  Hour?: number
  Day?: number
  Weekday?: number
  Month?: number
}
// launchd trigger — always a set of StartCalendarInterval dicts.
export type LaunchdTrigger = { kind: 'calendar'; entries: CalendarDict[] }

// Stored timing spec. `calendar` → one or more StartCalendarInterval dicts;
// `cron` → a raw 5-field expression parsed to the same.
export type ScheduleSpec =
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

// Parse a 5-field cron expression (min hour dom month dow) → calendar dicts.
// `*/N` and `*` are ordinary fields here: they expand to concrete values, so
// even "every 15 minutes" becomes four fixed StartCalendarInterval minutes
// rather than a drift-prone StartInterval.
export function cronToTrigger(expr: string): LaunchdTrigger {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('cron must have 5 fields: min hour dom month dow')
  const [minF, hourF, domF, monF, dowF] = fields

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
              throw new Error('cron expands to too many entries — narrow the expression')
          }
  return { kind: 'calendar', entries }
}

export function specToTrigger(spec: ScheduleSpec): LaunchdTrigger {
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
  if (spec.kind === 'cron') return `cron: ${spec.expr}`
  const at = hhmm(spec.hour, spec.minute)
  if (!spec.weekdays || spec.weekdays.length === 0 || spec.weekdays.length === 7)
    return `daily at ${at}`
  const days = [...spec.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d])
  return `${days.join(',')} at ${at}`
}

// Does a wall-clock minute match any of a trigger's calendar dicts?
function matchesTrigger(trig: LaunchdTrigger, d: Date): boolean {
  return trig.entries.some(
    (e) =>
      (e.Minute === undefined || e.Minute === d.getMinutes()) &&
      (e.Hour === undefined || e.Hour === d.getHours()) &&
      (e.Day === undefined || e.Day === d.getDate()) &&
      (e.Weekday === undefined || e.Weekday === d.getDay()) &&
      (e.Month === undefined || e.Month === d.getMonth() + 1),
  )
}

// Next fire time (ms) at or after `from`, computed exactly by scanning
// minute-by-minute up to a year out. Returns null if nothing matches.
export function nextRun(spec: ScheduleSpec, from = Date.now()): number | null {
  const trig = specToTrigger(spec)
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1) // start at the next whole minute
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matchesTrigger(trig, d)) return d.getTime()
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}

// Most recent fire time (ms) at or before `from`, scanning backward up to a
// year. This is the source of truth for the cadence watchdog: a schedule is
// "overdue" when its last actual run predates the previous expected fire.
export function prevRun(spec: ScheduleSpec, from = Date.now()): number | null {
  const trig = specToTrigger(spec)
  const d = new Date(from)
  d.setSeconds(0, 0) // include the current minute
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matchesTrigger(trig, d)) return d.getTime()
    d.setMinutes(d.getMinutes() - 1)
  }
  return null
}
