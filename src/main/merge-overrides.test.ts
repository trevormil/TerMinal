import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readMergeOverrideLog, readMergeOverrides, recordMergeOverride } from './merge-overrides'

const dirs: string[] = []
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'merge-overrides-'))
  dirs.push(dir)
  return join(dir, 'nested', 'merge-overrides.json')
}
afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    // A test may have chmod'd the log to 000 to force a read error.
    try {
      chmodSync(join(dir, 'nested', 'merge-overrides.json'), 0o644)
    } catch {
      /* not every test creates it */
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

/** True when the platform actually enforces the mode we just set (not root). */
function readIsDenied(file: string): boolean {
  try {
    readFileSync(file, 'utf8')
    return false
  } catch {
    return true
  }
}

describe('merge overrides', () => {
  test('an unwritten log reads as empty, not as a throw', () => {
    expect(readMergeOverrides(tempFile())).toEqual([])
  })

  test('records the PR, the legs that were unmet, and who — with no typed reason', () => {
    const file = tempFile()
    const rec = recordMergeOverride(file, {
      prIid: 42,
      repoRoot: '/repo',
      legs: ['tests', 'findings'],
      blockers: 'Tests not passing; 2 findings ≥ medium',
      who: 'trevor',
    })
    expect(rec.prIid).toBe(42)
    expect(rec.who).toBe('trevor')
    expect(rec.legs).toEqual(['tests', 'findings'])
    expect(rec.blockers).toContain('findings')
    expect(rec.ts).toBeGreaterThan(0)
    expect(rec).not.toHaveProperty('reason')
    expect(readMergeOverrides(file)).toEqual([rec])
  })

  test('legs are normalised to the known kinds in a stable order', () => {
    const rec = recordMergeOverride(tempFile(), {
      prIid: 1,
      repoRoot: '/r',
      // Out of order, with junk an older or buggy caller might send.
      legs: ['findings', 'sabotage', 'verdict'],
    })
    expect(rec.legs).toEqual(['verdict', 'findings'])
  })

  test('a caller that sends no legs still produces a record', () => {
    const rec = recordMergeOverride(tempFile(), { prIid: 7, repoRoot: '/r' })
    expect(rec.legs).toEqual([])
    expect(rec.prIid).toBe(7)
  })

  test('appends rather than replacing, so history survives', () => {
    const file = tempFile()
    recordMergeOverride(file, { prIid: 1, repoRoot: '/r', legs: ['tests'] })
    recordMergeOverride(file, { prIid: 2, repoRoot: '/r', legs: ['verdict'] })
    expect(readMergeOverrides(file).map((r) => r.prIid)).toEqual([1, 2])
  })

  test('creates the parent directory when it does not exist yet', () => {
    const file = tempFile()
    recordMergeOverride(file, { prIid: 3, repoRoot: '/r', legs: ['tests'] })
    expect(readMergeOverrides(file)).toHaveLength(1)
  })

  describe('never destroys a log it could not read', () => {
    test('absent, corrupt, and wrong-shape are distinguishable', () => {
      const file = tempFile()
      expect(readMergeOverrideLog(file)).toEqual({ records: [], present: false, corrupt: false })

      recordMergeOverride(file, { prIid: 1, repoRoot: '/r', legs: ['tests'] })
      expect(readMergeOverrideLog(file)).toMatchObject({ present: true, corrupt: false })

      writeFileSync(file, '{not json')
      expect(readMergeOverrideLog(file)).toMatchObject({ present: true, corrupt: true })

      // Parseable but the wrong shape is corruption too — an object here would
      // otherwise spread into the append and write a non-array log.
      writeFileSync(file, '{"legs":[]}')
      expect(readMergeOverrideLog(file).corrupt).toBe(true)
    })

    test('an empty file is treated as absent, not as corruption', () => {
      const file = tempFile()
      recordMergeOverride(file, { prIid: 1, repoRoot: '/r', legs: ['tests'] })
      writeFileSync(file, '   \n')
      expect(readMergeOverrideLog(file)).toEqual({ records: [], present: false, corrupt: false })
    })

    test('a corrupt log is quarantined byte-for-byte, and the new record still lands', () => {
      const file = tempFile()
      recordMergeOverride(file, { prIid: 1, repoRoot: '/r', legs: ['tests'] })
      writeFileSync(file, '{not json')
      const rec = recordMergeOverride(file, { prIid: 9, repoRoot: '/r', legs: ['findings'] })

      expect(readMergeOverrides(file)).toEqual([rec])
      const quarantined = readdirSync(dirname(file)).filter((f) => f.includes('.corrupt-'))
      expect(quarantined).toHaveLength(1)
      expect(readFileSync(join(dirname(file), quarantined[0]), 'utf8')).toBe('{not json')
    })

    test('two corruptions in a row keep both sets of bytes', () => {
      const file = tempFile()
      recordMergeOverride(file, { prIid: 0, repoRoot: '/r', legs: ['tests'] })
      writeFileSync(file, 'first corruption')
      recordMergeOverride(file, { prIid: 1, repoRoot: '/r', legs: ['tests'] })
      writeFileSync(file, 'second corruption')
      recordMergeOverride(file, { prIid: 2, repoRoot: '/r', legs: ['tests'] })

      const quarantined = readdirSync(dirname(file))
        .filter((f) => f.includes('.corrupt-'))
        .map((f) => readFileSync(join(dirname(file), f), 'utf8'))
        .sort()
      expect(quarantined).toEqual(['first corruption', 'second corruption'])
    })

    test('a transient read error aborts the append instead of wiping the history', () => {
      // The regression: the reader swallowed EVERY read failure into `[]`, and
      // the next append persisted that as the whole log. One EACCES or EMFILE
      // at the wrong moment silently deleted the entire audit trail of merges
      // that skipped the bar. "Absent" is the only state that may legitimately
      // produce an empty starting point.
      const file = tempFile()
      recordMergeOverride(file, { prIid: 1, repoRoot: '/r', legs: ['tests'] })
      recordMergeOverride(file, { prIid: 2, repoRoot: '/r', legs: ['verdict'] })
      const before = readFileSync(file, 'utf8')

      chmodSync(file, 0o000)
      if (!readIsDenied(file)) return // running as root; the mode is not enforced

      expect(() =>
        recordMergeOverride(file, { prIid: 3, repoRoot: '/r', legs: ['findings'] }),
      ).toThrow()

      chmodSync(file, 0o644)
      expect(readFileSync(file, 'utf8')).toBe(before)
      expect(readMergeOverrides(file).map((r) => r.prIid)).toEqual([1, 2])
      expect(readdirSync(dirname(file)).filter((f) => f.includes('.corrupt-'))).toEqual([])
    })

    test('the viewer degrades to empty rather than throwing on an unreadable log', () => {
      const file = tempFile()
      recordMergeOverride(file, { prIid: 1, repoRoot: '/r', legs: ['tests'] })
      chmodSync(file, 0o000)
      if (!readIsDenied(file)) return
      expect(readMergeOverrides(file)).toEqual([])
      chmodSync(file, 0o644)
    })
  })
})
