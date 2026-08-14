// ---- self-contained cron matcher (mirrors src/main/cron.ts) ----------------
// The runner imports nothing from the app bundle, so the calendar/cron
// evaluation the cadence watchdog needs is reimplemented here. Keep in sync
// with src/main/cron.ts (cronToTrigger / specToTrigger / prevRun).
import type { ScheduleSpec } from '../shared/types/schedules'

export function parseCronFieldLocal(field: string, min: number, max: number): number[] | null {
  if (field === '*') return null
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/)
    if (!m) return null // malformed → bail (watchdog skips this schedule)
    const [, range, stepRaw] = m
    const step = stepRaw ? Number(stepRaw) : 1
    if (step < 1) return null
    let lo: number, hi: number
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
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return [...out]
}

export type CronEntries = {
  minutes: number[] | null
  hours: number[] | null
  days: number[] | null
  months: number[] | null
  dows: number[] | null
}

// Reduce a spec to concrete allowed values per field (null = "any").
export function specEntriesLocal(spec: ScheduleSpec | undefined): CronEntries | null {
  if (!spec) return null
  if (spec.kind === 'cron') {
    const fields = String(spec.expr || '')
      .trim()
      .split(/\s+/)
    if (fields.length !== 5) return null
    const [minF, hourF, domF, monF, dowF] = fields
    const dows = parseCronFieldLocal(dowF, 0, 7)?.map((d) => (d === 7 ? 0 : d))
    return {
      minutes: parseCronFieldLocal(minF, 0, 59),
      hours: parseCronFieldLocal(hourF, 0, 23),
      days: parseCronFieldLocal(domF, 1, 31),
      months: parseCronFieldLocal(monF, 1, 12),
      dows: dows ? [...new Set(dows)] : null,
    }
  }
  if (spec.kind === 'calendar') {
    return {
      minutes: [spec.minute || 0],
      hours: [spec.hour || 0],
      days: null,
      months: null,
      dows: spec.weekdays && spec.weekdays.length ? spec.weekdays : null,
    }
  }
  return null
}

export function matchesEntriesLocal(e: CronEntries, d: Date): boolean {
  return (
    (e.minutes === null || e.minutes.includes(d.getMinutes())) &&
    (e.hours === null || e.hours.includes(d.getHours())) &&
    (e.days === null || e.days.includes(d.getDate())) &&
    (e.dows === null || e.dows.includes(d.getDay())) &&
    (e.months === null || e.months.includes(d.getMonth() + 1))
  )
}

// Most recent expected fire at or before `from` (ms), scanning back up to 45
// days. null if none — includes schedules that fire less often than that (the
// watchdog simply won't flag them, which is fine).
export const CADENCE_SCAN_DAYS = 45

export function prevExpectedFire(spec: ScheduleSpec | undefined, from: number): number | null {
  const e = specEntriesLocal(spec)
  if (!e) return null
  const d = new Date(from)
  d.setSeconds(0, 0)
  for (let i = 0; i < CADENCE_SCAN_DAYS * 24 * 60; i++) {
    if (matchesEntriesLocal(e, d)) return d.getTime()
    d.setMinutes(d.getMinutes() - 1)
  }
  return null
}
