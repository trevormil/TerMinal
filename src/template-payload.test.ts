import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// What the template CONTAINS is what a new repo gets: `scaffoldProject` copies
// the directory wholesale (cpSync, recursive), and `gh repo create --template`
// does the same. bootstrap.sh is the only path that picks individual files, so
// checking bootstrap alone proves nothing about the other two.
//
// The template used to carry `.TerMinal/backlog/.next-id`, `.TerMinal/sessions/`
// and README scaffolds for reviews/checks/reports. bootstrap stopped copying
// them, but every repo scaffolded from the app still got them — an in-repo
// backlog root, complete with an id counter, in the exact layout the sidecar
// exists to replace.

const TEMPLATE = join(import.meta.dir, '..', 'templates', 'project-template')
const STATE_AREAS = ['backlog', 'sessions', 'reviews', 'checks', 'reports']

describe('the project template ships no workflow state', () => {
  test('no in-repo state directories, in either layout', () => {
    const offenders: string[] = []
    for (const area of STATE_AREAS) {
      for (const rel of [area, `.${area}`, join('.TerMinal', area)]) {
        if (existsSync(join(TEMPLATE, rel))) offenders.push(rel)
      }
    }
    expect(offenders).toEqual([])
  })

  test('.TerMinal carries repo CONFIG only', () => {
    // Config is shared with the team and belongs in the repo; state is personal
    // and does not. Anything new here is a deliberate choice, not a default.
    const entries = readdirSync(join(TEMPLATE, '.TerMinal')).sort()
    expect(entries).toEqual(['snippets.json', 'template.json', 'widgets.json'])
  })

  test('no per-repo skill copies for either harness', () => {
    expect(existsSync(join(TEMPLATE, '.claude', 'skills'))).toBe(false)
    expect(existsSync(join(TEMPLATE, '.codex', 'skills'))).toBe(false)
  })

  test('what it DOES ship is the shared contracts (a guard matching nothing is not a guard)', () => {
    expect(statSync(join(TEMPLATE, '.agents')).isDirectory()).toBe(true)
    expect(statSync(join(TEMPLATE, 'docs')).isDirectory()).toBe(true)
    expect(existsSync(join(TEMPLATE, 'CLAUDE.md'))).toBe(true)
  })
})

// CLAUDE.md is the first thing every agent reads in a bootstrapped repo, and it
// linked `[.agents/forge.md](./.agents/forge.md)` long after bootstrap stopped
// creating that file. A relative link to something the repo will not contain
// sends the model to a dead path on its very first lookup.
describe('template docs only link to files a bootstrapped repo will have', () => {
  const RELATIVE_LINK = /\]\((\.\/[^)]+)\)/g

  for (const doc of ['CLAUDE.md', 'README.md']) {
    test(doc, () => {
      const body = readFileSync(join(TEMPLATE, doc), 'utf8')
      const missing: string[] = []
      for (const [, target] of body.matchAll(RELATIVE_LINK)) {
        // Strip any anchor; a link to a heading in another file still needs
        // the file itself.
        const rel = target.replace(/#.*$/, '').replace(/^\.\//, '')
        if (!rel || rel.startsWith('http')) continue
        if (!existsSync(join(TEMPLATE, rel))) missing.push(target)
      }
      expect(missing).toEqual([])
    })
  }

  test('the guard sees relative links at all (a guard matching nothing is not a guard)', () => {
    const found = [...'see [x](./docs/architecture.md) and [y](./nope.md)'.matchAll(RELATIVE_LINK)]
    expect(found.map((m) => m[1])).toEqual(['./docs/architecture.md', './nope.md'])
  })
})
