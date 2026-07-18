import { test, expect, describe } from 'bun:test'
import {
  bumpFromSubjects,
  nextVersion,
  parseVersionArg,
  cutChangelog,
  extractNotes,
  commitListNotes,
} from './versioning'

describe('bumpFromSubjects', () => {
  test('feat → minor', () => {
    expect(bumpFromSubjects(['feat(cockpit): add widget', 'fix: typo'])).toBe('minor')
  })

  test('fix/docs/chore only → patch', () => {
    expect(bumpFromSubjects(['fix: bug', 'docs: readme', 'chore: deps'])).toBe('patch')
  })

  test('breaking marker (!) → major, regardless of type', () => {
    expect(bumpFromSubjects(['fix!: drop legacy schedules format', 'feat: x'])).toBe('major')
    expect(bumpFromSubjects(['feat(api)!: rework Gt surface'])).toBe('major')
  })

  test('empty list → patch (release with no commits is still a patch)', () => {
    expect(bumpFromSubjects([])).toBe('patch')
  })

  test('non-conventional subjects count as patch, not ignored', () => {
    expect(bumpFromSubjects(['Update readme'])).toBe('patch')
  })
})

describe('nextVersion', () => {
  test('patch/minor/major increments with reset of lower parts', () => {
    expect(nextVersion('0.1.0', 'patch')).toBe('0.1.1')
    expect(nextVersion('0.1.9', 'minor')).toBe('0.2.0')
    expect(nextVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  test('rejects malformed current version', () => {
    expect(() => nextVersion('1.2', 'patch')).toThrow()
    expect(() => nextVersion('v1.2.3', 'patch')).toThrow()
  })
})

describe('parseVersionArg', () => {
  test('bump keywords pass through', () => {
    expect(parseVersionArg('patch')).toEqual({ kind: 'bump', bump: 'patch' })
    expect(parseVersionArg('minor')).toEqual({ kind: 'bump', bump: 'minor' })
    expect(parseVersionArg('major')).toEqual({ kind: 'bump', bump: 'major' })
  })

  test('explicit x.y.z (with or without v prefix) is explicit', () => {
    expect(parseVersionArg('0.2.0')).toEqual({ kind: 'explicit', version: '0.2.0' })
    expect(parseVersionArg('v1.0.0')).toEqual({ kind: 'explicit', version: '1.0.0' })
  })

  test('absent → auto, junk → null', () => {
    expect(parseVersionArg(undefined)).toEqual({ kind: 'auto' })
    expect(parseVersionArg('banana')).toBeNull()
    expect(parseVersionArg('1.2')).toBeNull()
  })
})

const CHANGELOG = `# Changelog

Intro prose.

## [Unreleased]

### Added
- Widget thing.

### Fixed
- A bug.

## [0.1.0] - 2026-07-01

### Added
- Initial.
`

describe('cutChangelog', () => {
  test('moves Unreleased content into a dated version section and empties Unreleased', () => {
    const { md, notes } = cutChangelog(CHANGELOG, '0.2.0', '2026-07-18')
    expect(md).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-07-18\n')
    expect(md).toContain('## [0.2.0] - 2026-07-18\n\n### Added\n- Widget thing.')
    // Old sections stay intact below.
    expect(md).toContain('## [0.1.0] - 2026-07-01')
    // Notes are exactly the cut content.
    expect(notes).toContain('### Added')
    expect(notes).toContain('- A bug.')
    expect(notes).not.toContain('Unreleased')
    expect(notes).not.toContain('0.1.0')
  })

  test('empty Unreleased → empty notes, section still created', () => {
    const empty = `# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-07-01\n\n- Initial.\n`
    const { md, notes } = cutChangelog(empty, '0.1.1', '2026-07-18')
    expect(notes).toBe('')
    expect(md).toContain('## [0.1.1] - 2026-07-18')
  })

  test('throws when the version section already exists (double-cut guard)', () => {
    const { md } = cutChangelog(CHANGELOG, '0.2.0', '2026-07-18')
    expect(() => cutChangelog(md, '0.2.0', '2026-07-18')).toThrow()
  })

  test('throws when there is no Unreleased heading', () => {
    expect(() => cutChangelog('# Changelog\n\nnothing here', '0.2.0', '2026-07-18')).toThrow()
  })
})

describe('extractNotes', () => {
  test('returns the body of an existing version section', () => {
    const { md } = cutChangelog(CHANGELOG, '0.2.0', '2026-07-18')
    const notes = extractNotes(md, '0.2.0')
    expect(notes).toContain('- Widget thing.')
    expect(notes).not.toContain('0.1.0')
  })

  test('returns null for a missing version', () => {
    expect(extractNotes(CHANGELOG, '9.9.9')).toBeNull()
  })
})

describe('commitListNotes', () => {
  test('renders subjects as markdown bullets', () => {
    expect(commitListNotes(['feat: a', 'fix: b'])).toBe('- feat: a\n- fix: b')
  })

  test('empty → empty string', () => {
    expect(commitListNotes([])).toBe('')
  })
})
