// Host repo resolution (ADR-0002 #18). A host-targeted schedule created in the
// LOCAL control plane would otherwise store the MAC repo path, which doesn't exist
// on the host — the runner's `git worktree add` off it fails. Resolve repoRoot to
// the host convention (~/repos/<name>, expanded by the runner against the host
// home) and ensure the repo is cloned there before the schedule fires.

import { execFile, execFileSync } from 'node:child_process'
import { basename } from 'node:path'
import { shq, isSafeSshTarget } from './remote'

const safeName = (root: string) => basename(root).match(/[\w.-]+/)?.[0] || 'repo'

// The host-relative repoRoot to persist on a host schedule. The runner expands
// the leading ~/ against the host's own home.
export function hostRepoRoot(macRepoRoot: string): string {
  return `~/repos/${safeName(macRepoRoot)}`
}

// Idempotent clone-if-absent command for the host. repoName is sanitized; the
// origin url is single-quoted. Guarded by a .git presence test so a re-sync never
// re-clones.
export function ensureRepoClonedCmd(repoName: string, originUrl: string): string {
  const name = /^[\w.-]+$/.test(repoName) ? repoName : 'repo'
  return `mkdir -p "$HOME/repos" && { [ -d "$HOME/repos/${name}/.git" ] || git clone ${shq(originUrl)} "$HOME/repos/${name}"; }`
}

function ssh(sshTarget: string, cmd: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!isSafeSshTarget(sshTarget)) return resolve({ ok: false, error: 'unsafe ssh target' })
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshTarget, `bash -lc ${shq(cmd)}`],
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      (err, _o, stderr) => (err ? resolve({ ok: false, error: (stderr || err.message).trim() }) : resolve({ ok: true })),
    )
  })
}

// Resolve + ensure the repo on the host. Reads the origin url from the LOCAL repo
// (the app has it), then clones on the host if absent. Returns the host-relative
// repoRoot to store on the schedule.
export async function ensureHostRepo(
  sshTarget: string,
  macRepoRoot: string,
): Promise<{ repoRoot: string; ok: boolean; error?: string }> {
  const repoRoot = hostRepoRoot(macRepoRoot)
  let originUrl = ''
  try {
    originUrl = execFileSync('git', ['-C', macRepoRoot, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  } catch {
    /* no origin */
  }
  if (!originUrl) return { repoRoot, ok: false, error: 'local repo has no origin remote to clone on the host' }
  const r = await ssh(sshTarget, ensureRepoClonedCmd(safeName(macRepoRoot), originUrl))
  return { repoRoot, ok: r.ok, error: r.error }
}
