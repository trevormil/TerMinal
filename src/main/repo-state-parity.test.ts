import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_STATE_BLOCK } from './repo-state-inline'
import { repoStateAreaPath } from './repo-state'

// bin/terminal-cli, bin/terminal-cron and bin/terminal-mcp-server cannot import
// from the app bundle, so each carries a copy of the sidecar resolver. Three
// separate bugs have already shipped from hand-copied logic drifting (the
// remote-host bootstrap markers, the Obsidian gap, this resolver), so the
// copies are generated from src/main/repo-state-inline.js and pinned here.

const ROOT = join(import.meta.dir, '..', '..')
const COPIES = ['bin/terminal-cli', 'bin/terminal-cron', 'bin/terminal-mcp-server']

describe('sidecar resolver copies', () => {
  for (const rel of COPIES) {
    test(`${rel} carries the canonical block verbatim`, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src).toContain(REPO_STATE_BLOCK)
    })
  }

  test('the sync script reports no drift', () => {
    // Fails loudly instead of silently rewriting during a test run.
    const out = execFileSync('bun', [join(ROOT, 'bin', 'sync-repo-state'), '--check'], {
      encoding: 'utf8',
      cwd: ROOT,
    })
    expect(out).toContain('already current')
  })

  test('the canonical block is actually wired in, not just present', () => {
    for (const rel of COPIES) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      // areaPath must delegate to the block rather than resolve repo-relative.
      expect(src).toContain('areaWritePath(root, area, areaCandidates(area)')
    }
  })
})

describe('inline resolver agrees with the app resolver', () => {
  // Same repo, same area, same answer — otherwise the app and the CLI would
  // disagree about where a ticket lives, which is the failure this whole
  // migration is meant to prevent.
  const run = (script: string, repo: string, stateDir: string) =>
    execFileSync(
      'bun',
      [
        '-e',
        `const { join, basename } = require('node:path')
         const { existsSync } = require('node:fs')
         const { execFileSync } = require('node:child_process')
         const { createHash } = require('node:crypto')
         const CFG = ${JSON.stringify(join(stateDir, 'cfg'))}
         ${REPO_STATE_BLOCK.replace(/^\/\/.*$/gm, '')}
         console.log(sidecarAreaPath(${JSON.stringify(repo)}, 'backlog'))`,
      ],
      { encoding: 'utf8', env: { ...process.env, TERMINAL_REPO_STATE_DIR: stateDir } },
    ).trim()

  test('origin-keyed repo resolves identically in both implementations', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'parity-'))
    try {
      const repo = join(tmp, 'r')
      mkdirSync(repo)
      execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' })
      execFileSync(
        'git',
        ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/o/parity.git'],
        { stdio: 'ignore' },
      )
      const stateDir = join(tmp, 'state')
      const prev = process.env.TERMINAL_REPO_STATE_DIR
      process.env.TERMINAL_REPO_STATE_DIR = stateDir
      const fromApp = repoStateAreaPath(repo, 'backlog')
      if (prev === undefined) delete process.env.TERMINAL_REPO_STATE_DIR
      else process.env.TERMINAL_REPO_STATE_DIR = prev

      expect(run('inline', repo, stateDir)).toBe(fromApp)
      expect(fromApp).toBe(join(stateDir, 'github.com/o/parity', 'backlog'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('no-origin repo hashes the same canonical path in both', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'parity-local-'))
    try {
      const repo = join(tmp, 'noorigin')
      mkdirSync(repo)
      execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' })
      writeFileSync(join(repo, 'f'), 'x')
      const stateDir = join(tmp, 'state')
      const prev = process.env.TERMINAL_REPO_STATE_DIR
      process.env.TERMINAL_REPO_STATE_DIR = stateDir
      const fromApp = repoStateAreaPath(repo, 'backlog')
      if (prev === undefined) delete process.env.TERMINAL_REPO_STATE_DIR
      else process.env.TERMINAL_REPO_STATE_DIR = prev

      // This is the case that would silently diverge if only one side
      // canonicalised the path through git (macOS /tmp -> /private/tmp).
      expect(run('inline', repo, stateDir)).toBe(fromApp)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
