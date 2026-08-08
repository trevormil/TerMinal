import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// TerMinal ships two decisions about what a repo should carry: skills come from
// the global tm plugin (ADR-0019) and workflow state lives in a per-project
// sidecar (ADR-0020). This repo was the loudest counter-example to both — it
// tracked a full .codex/skills mirror, six .claude/bin duplicates that had
// already drifted from plugin/bin, and 47 files of tickets and reviews.
//
// A rule the authoring repo exempts itself from is a rule that rots, so these
// hold TerMinal to its own ADRs.

const ROOT = join(import.meta.dir, '..')
const STATE_AREAS = ['backlog', 'sessions', 'reviews', 'checks', 'reports']

describe('TerMinal carries no workflow state of its own', () => {
  test('no state directories, in either layout', () => {
    const offenders: string[] = []
    for (const area of STATE_AREAS) {
      for (const rel of [area, `.${area}`, join('.TerMinal', area)]) {
        if (existsSync(join(ROOT, rel))) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  test('.gitignore keeps them from coming back', () => {
    const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    for (const rel of ['/backlog/', '/sessions/', '/reports/', '/.reviews/', '/.checks/'])
      expect(ignored).toContain(rel)
  })
})

describe('TerMinal carries no duplicate of the plugin', () => {
  test('no per-repo skills for either harness', () => {
    expect(existsSync(join(ROOT, '.claude', 'skills'))).toBe(false)
    expect(existsSync(join(ROOT, '.codex'))).toBe(false)
  })

  test('no .claude/bin — the plugin owns those helpers', () => {
    // Six copies lived here. Four had already drifted from plugin/bin by the
    // time anyone checked, which is the whole argument for one source.
    expect(existsSync(join(ROOT, '.claude', 'bin'))).toBe(false)
  })

  // The hooks are the deliberate exception: `.claude/settings.json` wires them
  // so a contributor who does not run the app still gets the merge gate. That
  // only works if they are the SAME gate — the repo copy was two revisions
  // behind the plugin's, missing the env FORCE override and the allowlist.
  test('the hook copies are byte-identical to the plugin they duplicate', () => {
    const hooks = readdirSync(join(ROOT, '.claude', 'hooks'))
    expect(hooks.length).toBeGreaterThan(0)
    for (const f of hooks) {
      const repoCopy = readFileSync(join(ROOT, '.claude', 'hooks', f), 'utf8')
      const pluginCopy = readFileSync(join(ROOT, 'plugin', 'hooks', f), 'utf8')
      expect({ [f]: repoCopy }).toEqual({ [f]: pluginCopy })
    }
  })
})
