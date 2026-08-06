import { execFileSync } from 'node:child_process'

// Read-mostly git views for the Files tab (history / branches / stashes /
// tags) — thin typed parsers over git plumbing, VS Code-style. The only
// mutations here are branch checkout/create; stash apply/pop/drop are
// deliberately absent (refs/stash is repo-global across worktrees — see the
// global CLAUDE.md stash warning — so the UI stays read-only for stashes).

const FS = '\x1f' // field separator
const RS = '\x1e' // record separator

// Patches can be arbitrarily large (a vendored dep bump); cap what we ship to
// the renderer so one commit can't wedge the IPC channel.
const PATCH_CAP = 2 * 1024 * 1024

export type GitCommit = {
  sha: string
  shortSha: string
  parents: string[]
  author: string
  /** Unix ms. */
  date: number
  subject: string
  /** Ref decorations pointing at this commit (HEAD -> main, origin/main, tag: v1). */
  refs: string[]
}

export type GitLogResult = { ok: true; commits: GitCommit[] } | { ok: false; error: string }

export type GitCommitFile = {
  path: string
  insertions: number
  deletions: number
  /** True for binary files (numstat reports "-"). */
  binary: boolean
}

export type GitCommitDetail =
  | {
      ok: true
      sha: string
      shortSha: string
      author: string
      email: string
      date: number
      subject: string
      body: string
      refs: string[]
      files: GitCommitFile[]
      patch: string
      patchTruncated: boolean
    }
  | { ok: false; error: string }

export type GitBranch = {
  name: string
  current: boolean
  remote: boolean
  sha: string
  subject: string
  /** Unix ms of the tip commit. */
  date: number
  upstream: string
  ahead: number
  behind: number
}

export type GitBranchesResult = { ok: true; branches: GitBranch[] } | { ok: false; error: string }

export type GitStash = { ref: string; branch: string; subject: string; date: number }
export type GitStashesResult = { ok: true; stashes: GitStash[] } | { ok: false; error: string }

export type GitTag = { name: string; sha: string; subject: string; date: number }
export type GitTagsResult = { ok: true; tags: GitTag[] } | { ok: false; error: string }

export type GitOpResult = { ok: true } | { ok: false; error: string }

function run(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  })
}

function errMessage(e: unknown): string {
  const err = e as { stderr?: string; message?: string }
  const stderr = (err.stderr || '').toString().trim()
  return (stderr || err.message || 'git failed').split('\n')[0]
}

const splitRefs = (d: string): string[] =>
  d
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function gitLog(
  root: string,
  opts?: { limit?: number; skip?: number; ref?: string },
): GitLogResult {
  if (!root) return { ok: false, error: 'not a git repo' }
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 100))
  const skip = Math.max(0, opts?.skip ?? 0)
  try {
    const out = run(root, [
      'log',
      `--max-count=${limit}`,
      `--skip=${skip}`,
      `--format=%H${FS}%h${FS}%P${FS}%an${FS}%at${FS}%D${FS}%s${RS}`,
      ...(opts?.ref ? [opts.ref] : []),
      '--',
    ])
    const commits: GitCommit[] = []
    for (const rec of out.split(RS)) {
      const line = rec.replace(/^\n/, '')
      if (!line.trim()) continue
      const [sha, shortSha, parents, author, at, refs, subject] = line.split(FS)
      if (!sha) continue
      commits.push({
        sha,
        shortSha,
        parents: (parents || '').split(' ').filter(Boolean),
        author: author || '',
        date: (Number(at) || 0) * 1000,
        subject: subject || '',
        refs: splitRefs(refs || ''),
      })
    }
    return { ok: true, commits }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}

export function gitShow(root: string, ref: string): GitCommitDetail {
  if (!root) return { ok: false, error: 'not a git repo' }
  if (!ref?.trim()) return { ok: false, error: 'no ref' }
  try {
    // Three passes over the same commit: -s meta, --numstat file rollup, and
    // the patch itself. Each is cheap; splitting one combined output apart
    // reliably is not (bodies and patches both contain blank lines).
    const meta = run(root, [
      'show',
      '-s',
      `--format=%H${FS}%h${FS}%an${FS}%ae${FS}%at${FS}%D${FS}%s${FS}%b`,
      ref,
      '--',
    ])
    const [sha, shortSha, author, email, at, refs, subject, ...bodyParts] = meta
      .replace(/\n$/, '')
      .split(FS)
    const numstat = run(root, ['show', '--numstat', '--format=', ref, '--'])
    const files: GitCommitFile[] = []
    for (const line of numstat.split('\n')) {
      const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/)
      if (!m) continue
      files.push({
        path: m[3],
        insertions: m[1] === '-' ? 0 : Number(m[1]),
        deletions: m[2] === '-' ? 0 : Number(m[2]),
        binary: m[1] === '-',
      })
    }
    const fullPatch = run(root, ['show', '--patch', '--format=', ref, '--'])
    const patchTruncated = fullPatch.length > PATCH_CAP
    return {
      ok: true,
      sha: sha || ref,
      shortSha: shortSha || ref,
      author: author || '',
      email: email || '',
      date: (Number(at) || 0) * 1000,
      subject: subject || '',
      body: (bodyParts.join(FS) || '').trim(),
      refs: splitRefs(refs || ''),
      files,
      patch: patchTruncated ? fullPatch.slice(0, PATCH_CAP) : fullPatch,
      patchTruncated,
    }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}

export function gitBranches(root: string): GitBranchesResult {
  if (!root) return { ok: false, error: 'not a git repo' }
  try {
    const out = run(root, [
      'for-each-ref',
      'refs/heads',
      'refs/remotes',
      '--sort=-committerdate',
      `--format=%(refname:short)${FS}%(objectname)${FS}%(HEAD)${FS}%(upstream:short)${FS}%(upstream:track)${FS}%(committerdate:unix)${FS}%(subject)${FS}%(refname)`,
    ])
    const branches: GitBranch[] = []
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const [name, sha, head, upstream, track, at, subject, refname] = line.split(FS)
      if (!name || name.endsWith('/HEAD')) continue // origin/HEAD symref is noise
      const ahead = Number(track?.match(/ahead (\d+)/)?.[1] || 0)
      const behind = Number(track?.match(/behind (\d+)/)?.[1] || 0)
      branches.push({
        name,
        sha: sha || '',
        current: head === '*',
        remote: (refname || '').startsWith('refs/remotes/'),
        upstream: upstream || '',
        ahead,
        behind,
        date: (Number(at) || 0) * 1000,
        subject: subject || '',
      })
    }
    return { ok: true, branches }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}

/** Switch to a branch. `git switch` DWIMs a remote-only name into a local
 *  tracking branch, so the caller passes short names (no `origin/` prefix). */
export function gitCheckout(root: string, branch: string): GitOpResult {
  if (!root) return { ok: false, error: 'not a git repo' }
  if (!branch?.trim()) return { ok: false, error: 'no branch' }
  try {
    run(root, ['switch', branch.trim()])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}

export function gitCreateBranch(root: string, name: string, from?: string): GitOpResult {
  if (!root) return { ok: false, error: 'not a git repo' }
  if (!name?.trim()) return { ok: false, error: 'no branch name' }
  try {
    run(root, ['switch', '-c', name.trim(), ...(from?.trim() ? [from.trim()] : [])])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}

export type GitPatchResult = { ok: true; patch: string } | { ok: false; error: string }

// `git diff` exits 1 when files differ — the NORMAL case — so capture stdout
// off the thrown error instead of treating it as failure.
function runDiff(root: string, args: string[]): string {
  try {
    return run(root, args)
  } catch (e) {
    const err = e as { stdout?: string | Buffer; status?: number }
    if (err.status === 1 && err.stdout != null) return err.stdout.toString()
    throw e
  }
}

/** One file's HEAD → working-tree unified patch (untracked → whole-file add).
 *  Feeds the same DiffView the PR diff tab renders. */
export function gitWorkingFilePatch(root: string, rel: string): GitPatchResult {
  if (!root) return { ok: false, error: 'not a git repo' }
  if (!rel?.trim()) return { ok: false, error: 'no file' }
  try {
    const tracked = runDiff(root, ['diff', 'HEAD', '--', rel])
    if (tracked.trim()) return { ok: true, patch: tracked }
    // Untracked file? HEAD diff is silent about it — render as an addition.
    const untracked = run(root, ['ls-files', '--others', '--exclude-standard', '--', rel])
    if (untracked.trim()) {
      return { ok: true, patch: runDiff(root, ['diff', '--no-index', '--', '/dev/null', rel]) }
    }
    return { ok: true, patch: '' }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}

/** Two working-tree files diffed against each other (tree "compare with"). */
export function gitCompareFilesPatch(root: string, a: string, b: string): GitPatchResult {
  if (!root) return { ok: false, error: 'not a git repo' }
  if (!a?.trim() || !b?.trim()) return { ok: false, error: 'need two files' }
  try {
    return { ok: true, patch: runDiff(root, ['diff', '--no-index', '--', a, b]) }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}

export function gitStashes(root: string): GitStashesResult {
  if (!root) return { ok: false, error: 'not a git repo' }
  try {
    const out = run(root, ['stash', 'list', `--format=%gd${FS}%at${FS}%gs`])
    const stashes: GitStash[] = []
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const [ref, at, subject] = line.split(FS)
      if (!ref) continue
      // %gs looks like "On main: wip: a change" (or "WIP on main: <sha> msg").
      const branch = subject?.match(/^(?:WIP on|On) ([^:]+):/)?.[1] || ''
      stashes.push({ ref, branch, subject: subject || '', date: (Number(at) || 0) * 1000 })
    }
    return { ok: true, stashes }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}

export function gitTags(root: string): GitTagsResult {
  if (!root) return { ok: false, error: 'not a git repo' }
  try {
    // *objectname/*subject = the PEELED commit for annotated tags; plain
    // (lightweight) tags fall back to the object itself.
    const out = run(root, [
      'for-each-ref',
      'refs/tags',
      '--sort=-creatordate',
      `--format=%(refname:short)${FS}%(*objectname)${FS}%(objectname)${FS}%(creatordate:unix)${FS}%(*subject)${FS}%(subject)`,
    ])
    const tags: GitTag[] = []
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const [name, peeled, obj, at, peeledSubject, subject] = line.split(FS)
      if (!name) continue
      tags.push({
        name,
        sha: peeled || obj || '',
        subject: peeledSubject || subject || '',
        date: (Number(at) || 0) * 1000,
      })
    }
    return { ok: true, tags }
  } catch (e) {
    return { ok: false, error: errMessage(e) }
  }
}
