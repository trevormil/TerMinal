import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// plugin/bin/forge stopped being seeded per-repo (.claude/forge) — resolution
// is now: legacy repo file → sidecar override → $FORGE → origin autodetect →
// github. Run the real script against fixture repos so every layer is pinned.

const FORGE = join(import.meta.dir, '..', 'plugin', 'bin', 'forge')

let tmp: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'forge-')))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

function repoWithOrigin(url: string): string {
  const dir = join(tmp, `r${Math.abs(Buffer.from(url).reduce((a, b) => a + b, 0))}`)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', url], { stdio: 'ignore' })
  return dir
}

const run = (cwd: string, env: Record<string, string> = {}) => {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(TERMINAL_|FORGE$)/.test(k)),
  )
  return execFileSync('bash', [FORGE], { cwd, encoding: 'utf8', env: { ...clean, ...env } }).trim()
}

describe('forge resolution without any per-repo seed', () => {
  test('autodetects github from origin', () => {
    expect(run(repoWithOrigin('https://github.com/o/r.git'))).toBe('github')
  })

  test('autodetects gitlab from origin (incl. self-hosted with gitlab in host)', () => {
    expect(run(repoWithOrigin('git@gitlab.example.com:o/r.git'))).toBe('gitlab')
  })

  test('$FORGE env overrides autodetect', () => {
    expect(run(repoWithOrigin('https://github.com/o/r.git'), { FORGE: 'gitlab' })).toBe('gitlab')
  })

  test('sidecar forge file overrides autodetect and env', () => {
    const repo = repoWithOrigin('https://github.com/o/r.git')
    const sidecar = join(tmp, 'sidecar')
    mkdirSync(sidecar, { recursive: true })
    writeFileSync(join(sidecar, 'forge'), 'gitlab\n')
    expect(run(repo, { TERMINAL_STATE_DIR: sidecar, FORGE: 'github' })).toBe('gitlab')
  })

  test('legacy .claude/forge still wins when present', () => {
    const repo = repoWithOrigin('https://github.com/o/r.git')
    mkdirSync(join(repo, '.claude'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'forge'), 'gitlab\n')
    expect(run(repo)).toBe('gitlab')
  })

  test('no origin at all falls back to github', () => {
    const dir = join(tmp, 'bare')
    mkdirSync(dir, { recursive: true })
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' })
    expect(run(dir)).toBe('github')
  })
})
