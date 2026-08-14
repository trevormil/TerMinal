import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  INSIDE_MIGRATION_WINDOW,
  MIGRATION_SUNSET_AT,
  migrationWindowOpen,
  setMigrationClock,
} from '../shared/migration-sunset'

// setMigrationClock exists so tests of the LEGACY read path can pin themselves
// inside the migration window. A production caller would freeze (or fake) the
// sunset for real users, which is the one thing the automatic end date exists
// to prevent — so the seam is guarded rather than trusted.

const ROOT = join(import.meta.dir, '..')

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) yield* sources(abs)
    else if (/\.(ts|tsx|cjs)$/.test(e.name)) yield abs
  }
}

describe('the migration clock seam is test-only', () => {
  test('no shipped source calls setMigrationClock', () => {
    const offenders = [...sources(ROOT)]
      .map((abs) => abs.slice(ROOT.length + 1))
      .filter((rel) => !rel.includes('.test.'))
      .filter(
        (rel) =>
          rel !== join('shared', 'migration-sunset.ts') &&
          readFileSync(join(ROOT, rel), 'utf8').includes('setMigrationClock('),
      )
    expect(offenders).toEqual([])
  })

  test('the seam actually overrides the default clock, and unsets cleanly', () => {
    // A guard over a no-op seam would be worthless: prove it moves the answer.
    setMigrationClock(MIGRATION_SUNSET_AT)
    expect(migrationWindowOpen()).toBe(false)
    setMigrationClock(INSIDE_MIGRATION_WINDOW)
    expect(migrationWindowOpen()).toBe(true)
    setMigrationClock(null)
    expect(migrationWindowOpen()).toBe(Date.now() < MIGRATION_SUNSET_AT.getTime())
  })

  test('an explicit argument still beats the pinned clock', () => {
    setMigrationClock(INSIDE_MIGRATION_WINDOW)
    try {
      expect(migrationWindowOpen(MIGRATION_SUNSET_AT)).toBe(false)
    } finally {
      setMigrationClock(null)
    }
  })
})
