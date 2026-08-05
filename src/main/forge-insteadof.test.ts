import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forgeFor, listRaw, resetForgeListRawInFlightForTests, setForgeRunForTests } from './forge'

// e2e for the PRs tab under `url.<base>.insteadOf`: a repo whose GitHub origin
// is rewritten to a local ssh alias reported "no PRs / no forge" even with PRs
// open. Two things broke at once — we picked `glab` because the alias host isn't
// github.com, and `gh` itself refuses ("none of the git remotes configured for
// this repository point to a known GitHub host") because it applies the very
// same rewrite. This drives the real code path against a stand-in `gh` that
// enforces gh's actual rule.
//
// The stand-in resolves the repo exactly as gh does: GH_REPO wins, otherwise
// the (rewritten) origin must be on github.com.
const FAKE_GH = `#!/bin/sh
repo="$GH_REPO"
if [ -z "$repo" ]; then
  url=$(git remote get-url origin 2>/dev/null)
  case "$url" in
    *github.com[:/]*) repo=$(echo "$url" | sed -E 's#.*github\\.com[:/]##; s#\\.git$##') ;;
    *)
      echo "none of the git remotes configured for this repository point to a known GitHub host." >&2
      exit 1 ;;
  esac
fi
echo "[{\\"number\\":278,\\"title\\":\\"$repo\\",\\"state\\":\\"OPEN\\",\\"author\\":{\\"login\\":\\"t\\"},\\"headRefName\\":\\"f\\",\\"isDraft\\":false,\\"url\\":\\"u\\",\\"headRefOid\\":\\"abc1234def\\",\\"labels\\":[]}]"
`

describe('PRs under url.<base>.insteadOf (e2e)', () => {
  let dir = ''
  let binDir = ''
  let cfgDir = ''
  let prevPath = ''
  let prevCfg: string | undefined
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

  beforeEach(() => {
    resetForgeListRawInFlightForTests()
    setForgeRunForTests(null)
    dir = mkdtempSync(join(tmpdir(), 'forge-io-'))
    binDir = mkdtempSync(join(tmpdir(), 'forge-bin-'))
    cfgDir = mkdtempSync(join(tmpdir(), 'forge-cfg-'))
    writeFileSync(join(binDir, 'gh'), FAKE_GH)
    chmodSync(join(binDir, 'gh'), 0o755)
    prevPath = process.env.PATH || ''
    process.env.PATH = `${binDir}:${prevPath}`
    prevCfg = process.env.TERMINAL_CONFIG_DIR
    process.env.TERMINAL_CONFIG_DIR = cfgDir // default settings → forge pref 'auto'
    git('init', '-b', 'main')
    git('remote', 'add', 'origin', 'git@github.com:owner/repo.git')
    git('config', 'url.git@github-personal:.insteadOf', 'git@github.com:')
  })
  afterEach(() => {
    process.env.PATH = prevPath
    if (prevCfg === undefined) delete process.env.TERMINAL_CONFIG_DIR
    else process.env.TERMINAL_CONFIG_DIR = prevCfg
    resetForgeListRawInFlightForTests()
    for (const d of [dir, binDir, cfgDir]) rmSync(d, { recursive: true, force: true })
  })

  test('the rewritten repo is still detected as GitHub', () => {
    expect(forgeFor(dir).kind).toBe('github')
  })

  test('open PRs are listed, against the canonical repo', async () => {
    const r = await listRaw(dir)
    expect(r.error).toBeUndefined()
    expect(r.items.map((m) => m.iid)).toEqual([278])
    // gh was pointed at the real repo, not the local alias
    expect(r.items[0].title).toBe('owner/repo')
  })
})
