// Pure version/changelog logic for the release flow. Kept free of I/O so the
// bump derivation and changelog surgery are unit-testable; bin/cut-release and
// scripts/release/notes.ts are the thin I/O wrappers.

export type Bump = 'major' | 'minor' | 'patch'

export type VersionArg =
  { kind: 'auto' } | { kind: 'bump'; bump: Bump } | { kind: 'explicit'; version: string }

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
// Conventional-commit breaking marker: "type!:" or "type(scope)!:".
const BREAKING = /^[a-z]+(\([^)]*\))?!:/i
const FEAT = /^feat(\([^)]*\))?:/i

/** feat → minor, breaking (`!`) → major, anything else (fix/docs/junk) → patch. */
export function bumpFromSubjects(subjects: string[]): Bump {
  if (subjects.some((s) => BREAKING.test(s))) return 'major'
  if (subjects.some((s) => FEAT.test(s))) return 'minor'
  return 'patch'
}

export function nextVersion(current: string, bump: Bump): string {
  const m = current.match(SEMVER)
  if (!m) throw new Error(`not a semver version: "${current}"`)
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/** CLI arg → auto (absent) | bump keyword | explicit version; null = unusable. */
export function parseVersionArg(arg: string | undefined): VersionArg | null {
  if (arg === undefined || arg === '') return { kind: 'auto' }
  if (arg === 'major' || arg === 'minor' || arg === 'patch') return { kind: 'bump', bump: arg }
  const bare = arg.replace(/^v/, '')
  if (SEMVER.test(bare)) return { kind: 'explicit', version: bare }
  return null
}

const unreleasedRe = /^## \[Unreleased\][ \t]*$/m

/**
 * Cut the [Unreleased] section into a `## [version] - date` section directly
 * below it. Returns the rewritten changelog and the cut body (the release
 * notes — empty string when Unreleased had nothing).
 */
export function cutChangelog(
  md: string,
  version: string,
  date: string,
): { md: string; notes: string } {
  if (md.includes(`## [${version}]`)) throw new Error(`section [${version}] already exists`)
  const heading = md.match(unreleasedRe)
  if (!heading || heading.index === undefined) throw new Error('no ## [Unreleased] heading')
  const bodyStart = heading.index + heading[0].length
  const rest = md.slice(bodyStart)
  const nextSection = rest.search(/^## /m)
  const bodyEnd = nextSection === -1 ? md.length : bodyStart + nextSection
  const notes = md.slice(bodyStart, bodyEnd).trim()
  const rewritten =
    md.slice(0, bodyStart) +
    `\n\n## [${version}] - ${date}\n\n` +
    (notes ? `${notes}\n\n` : '') +
    md.slice(bodyEnd)
  return { md: rewritten, notes }
}

/** Body of an existing `## [version]` section, or null when absent. */
export function extractNotes(md: string, version: string): string | null {
  const headingRe = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\n]*$`, 'm')
  const heading = md.match(headingRe)
  if (!heading || heading.index === undefined) return null
  const bodyStart = heading.index + heading[0].length
  const rest = md.slice(bodyStart)
  const nextSection = rest.search(/^## /m)
  const bodyEnd = nextSection === -1 ? md.length : bodyStart + nextSection
  return md.slice(bodyStart, bodyEnd).trim()
}

/** Fallback release notes: the raw commit subjects as bullets. */
export function commitListNotes(subjects: string[]): string {
  return subjects.map((s) => `- ${s}`).join('\n')
}
