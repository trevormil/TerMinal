import { describe, expect, test } from 'bun:test'
import { MIGRATION_SUNSET, migrationWindowOpen } from './migration-sunset'

// The whole sunset rests on one boundary, so pin it explicitly: a date-off-by-
// one here silently keeps the legacy read path alive (or kills it a day early
// for every user in a negative-offset timezone).

describe('migrationWindowOpen', () => {
  test('is open the day before the sunset', () => {
    expect(migrationWindowOpen(new Date('2026-10-12T23:59:59Z'))).toBe(true)
  })

  test('is CLOSED at the instant the sunset date begins', () => {
    expect(migrationWindowOpen(new Date(`${MIGRATION_SUNSET}T00:00:00Z`))).toBe(false)
  })

  test('is closed after the sunset', () => {
    expect(migrationWindowOpen(new Date('2027-01-01T00:00:00Z'))).toBe(false)
  })

  test('is open for dates well before it', () => {
    expect(migrationWindowOpen(new Date('2026-08-13T12:00:00Z'))).toBe(true)
  })

  test('the boundary is UTC, not local — the same instant everywhere', () => {
    // 2026-10-12T20:00 in UTC-5 is already 2026-10-13T01:00 UTC: closed.
    expect(migrationWindowOpen(new Date('2026-10-12T20:00:00-05:00'))).toBe(false)
    // ...and 2026-10-13T08:00 in UTC+13 is still 2026-10-12T19:00 UTC: open.
    expect(migrationWindowOpen(new Date('2026-10-13T08:00:00+13:00'))).toBe(true)
  })

  test('defaults to the real clock when no date is injected', () => {
    expect(migrationWindowOpen()).toBe(Date.now() < Date.parse(`${MIGRATION_SUNSET}T00:00:00Z`))
  })
})
