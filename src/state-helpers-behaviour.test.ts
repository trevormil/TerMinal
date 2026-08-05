import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Four separate bugs shipped where a skill helper prefixed an ABSOLUTE sidecar
// path with the repo root, writing state back inside the repo. Text guards
// caught the first three and missed the fourth, because that one assigned the
// var to an intermediate and joined it on a later line — a data-flow bug no
// single-line regex can see.
//
// So stop reading the scripts and RUN them: whatever a helper resolves or
// creates must be under the sidecar, and the repo must be untouched. That holds
// however the path is spelled.

let tmp: string
let repo: string
let stateDir: string

const PLUGIN_BIN = join(import.meta.dir, '..', 'plugin', 'bin')

const run = (script: string, args: string[] = []) =>
  execFileSync('bash', [script, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: join(tmp, 'home'),
      TERMINAL_REPO_STATE_DIR: stateDir,
      PATH: `${PLUGIN_BIN}:${process.env.PATH}`,
      // Deliberately NOT setting TERMINAL_*_DIR: this is the plain-shell case,
      // where a helper must resolve the sidecar itself.
    },
  }).trim()

/** Files anywhere under the repo that look like workflow state. */
function stateFilesInRepo(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === '.git') continue
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p.slice(repo.length + 1))
    }
  }
  walk(repo)
  return out.filter((p) => /(^|\/)(backlog|sessions|reviews|checks|reports)\//.test(p))
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'helper-behaviour-')))
  stateDir = join(tmp, 'state')
  mkdirSync(join(tmp, 'home'), { recursive: true })
  repo = join(tmp, 'repo')
  mkdirSync(repo, { recursive: true })
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' })
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/o/beh.git'], {
    stdio: 'ignore',
  })
  // A v2 repo: layout marker present, no legacy in-repo dirs.
  mkdirSync(join(repo, '.TerMinal'), { recursive: true })
  writeFileSync(join(repo, '.TerMinal', 'template.json'), '{"version":2}\n')
})

afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const HELPERS = [
  // `creates` — an id allocator bootstraps its dir; a pure resolver only prints.
  {
    name: 'ticket-dir',
    script: 'plugin/skills/ticket/bin/ticket-dir',
    area: 'backlog',
    creates: false,
  },
  {
    name: 'next-ticket-id',
    script: 'plugin/skills/ticket/bin/next-ticket-id',
    area: 'backlog',
    creates: true,
  },
  {
    name: 'next-session-id',
    script: 'plugin/skills/session-start/bin/next-session-id',
    area: 'sessions',
    creates: true,
  },
]

describe('skill helpers resolve into the sidecar, never into the repo', () => {
  for (const { name, script, area, creates } of HELPERS) {
    test(`${name} writes nothing inside the repo`, () => {
      const abs = join(import.meta.dir, '..', script)
      if (!existsSync(abs)) throw new Error(`missing helper: ${script}`)
      run(abs)

      // The repo must be untouched by workflow state...
      expect(stateFilesInRepo()).toEqual([])
      // ...and specifically must not contain a nested absolute path, which is
      // what "$ROOT/$TERMINAL_<AREA>_DIR" produces.
      expect(existsSync(join(repo, 'Users'))).toBe(false)
      expect(existsSync(join(repo, tmp.replace(/^\//, '')))).toBe(false)
      // Whatever it created belongs to the sidecar.
      if (creates) expect(existsSync(join(stateDir, 'github.com/o/beh', area))).toBe(true)
    })
  }

  test('ticket-dir prints a path inside the sidecar', () => {
    const out = run(join(import.meta.dir, '..', 'plugin/skills/ticket/bin/ticket-dir'))
    expect(out).toBe(join(stateDir, 'github.com/o/beh', 'backlog'))
    expect(out.startsWith(repo)).toBe(false)
  })

  test('a legacy in-repo layout still resolves in-repo (migration-free reads)', () => {
    rmSync(join(repo, '.TerMinal'), { recursive: true, force: true })
    mkdirSync(join(repo, 'backlog'), { recursive: true })
    const out = run(join(import.meta.dir, '..', 'plugin/skills/ticket/bin/ticket-dir'))
    expect(out).toBe(join(repo, 'backlog'))
  })
})
