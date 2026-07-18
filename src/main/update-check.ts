// Update check — is the installed build's commit behind origin/main?
//
// The installed /Applications/TerMinal.app is a snapshot (bin/release), so it
// can lag main now that releases happen after PR merges, not on every commit.
// This compares the baked build sha (__BUILD_SHA__, electron.vite.config.ts)
// against upstream: preferably via the LOCAL source checkout's origin/main
// (git fetch + merge-base/rev-list — exact and works for any fork), falling
// back to the unauthenticated GitHub compare API when no checkout is around.
// Every failure degrades to status 'unknown' — the check never throws and
// never blocks startup.
import { execFile } from 'node:child_process'

export type UpdateStatus = 'up-to-date' | 'behind' | 'diverged' | 'unknown'
export type UpdateCheckResult = {
  buildSha: string // short sha as baked, -dirty suffix stripped ('' → uncomparable)
  buildDirty: boolean // build was made from an uncommitted working tree
  status: UpdateStatus
  behindBy: number // commits origin/main is ahead of the build (when status 'behind')
  latestSha: string // short sha of origin/main when known
  source: 'git' | 'github' | 'none'
  checkedAt: number
  repoPath?: string // the source checkout used for the git check (for UI hints)
  checkoutBranch?: string // current branch of that checkout (git source only)
  checkoutDirty?: boolean // that checkout has local changes (git source only)
  error?: string
}

/** Split the baked build stamp into a comparable sha + dirty flag. */
export function parseBuildSha(stamp: string): { sha: string; dirty: boolean } {
  const dirty = stamp.endsWith('-dirty')
  const sha = (dirty ? stamp.slice(0, -'-dirty'.length) : stamp).trim()
  return { sha: /^[0-9a-f]{4,40}$/i.test(sha) ? sha : '', dirty }
}

/** Runs git in the target repo; resolves trimmed stdout, rejects on non-zero exit. */
export type GitRunner = (args: string[]) => Promise<string>

const gitRunnerFor =
  (repoPath: string): GitRunner =>
  (args) =>
    new Promise((resolve, reject) => {
      execFile(
        'git',
        ['-C', repoPath, ...args],
        { encoding: 'utf8', timeout: 20_000 },
        (err, stdout) => (err ? reject(err) : resolve(stdout.trim())),
      )
    })

// origin's default branch: origin/HEAD's target, else main, else master, else ''.
async function defaultBranch(run: GitRunner): Promise<string> {
  try {
    const b = (await run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(
      /^origin\//,
      '',
    )
    if (b) return b
  } catch {
    /* fall through to probes */
  }
  for (const b of ['main', 'master']) {
    try {
      await run(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`])
      return b
    } catch {
      /* try next */
    }
  }
  return ''
}

// Local-checkout comparison. Returns null when this path can't answer (no
// origin default branch, or the checkout doesn't contain the build sha) so the
// caller can fall back to the GitHub API.
async function checkViaLocalRepo(
  sha: string,
  repoPath: string,
  run: GitRunner,
): Promise<Omit<UpdateCheckResult, 'buildSha' | 'buildDirty' | 'checkedAt'> | null> {
  try {
    await run(['fetch', '--quiet', '--prune', 'origin'])
  } catch {
    /* offline — compare against the last-fetched ref instead */
  }
  const branch = await defaultBranch(run)
  if (!branch) return null
  try {
    await run(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])
  } catch {
    return null // checkout doesn't know the build sha (gc'd / different history)
  }
  const upstream = `origin/${branch}`
  const latestSha = await run(['rev-parse', '--short', upstream])
  let ancestor = true
  try {
    await run(['merge-base', '--is-ancestor', sha, upstream])
  } catch {
    ancestor = false
  }
  const behindBy = ancestor
    ? parseInt(await run(['rev-list', '--count', `${sha}..${upstream}`]), 10) || 0
    : 0
  // Checkout state, so the UI can warn that "Update now" (bin/release) would
  // build a branch/dirty tree instead of pulling main. Best-effort.
  let checkoutBranch: string | undefined
  let checkoutDirty: boolean | undefined
  try {
    checkoutBranch = await run(['branch', '--show-current'])
    checkoutDirty = (await run(['status', '--porcelain'])).length > 0
  } catch {
    /* cosmetic only */
  }
  return {
    status: !ancestor ? 'diverged' : behindBy > 0 ? 'behind' : 'up-to-date',
    behindBy,
    latestSha,
    source: 'git',
    repoPath,
    checkoutBranch,
    checkoutDirty,
  }
}

// GitHub compare API fallback: base = build sha, head = main. head "ahead" of
// base by N == the build is N commits behind main.
async function checkViaGitHub(
  sha: string,
  repoSlug: string,
  fetchImpl: typeof fetch,
): Promise<Omit<UpdateCheckResult, 'buildSha' | 'buildDirty' | 'checkedAt'>> {
  const res = await fetchImpl(`https://api.github.com/repos/${repoSlug}/compare/${sha}...main`, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    return {
      status: 'unknown',
      behindBy: 0,
      latestSha: '',
      source: 'github',
      error: `GitHub compare failed (HTTP ${res.status})`,
    }
  }
  const body = (await res.json()) as {
    status?: string
    ahead_by?: number
    commits?: { sha?: string }[]
  }
  const head = body.commits?.[body.commits.length - 1]?.sha || ''
  return {
    status:
      body.status === 'identical'
        ? 'up-to-date'
        : body.status === 'ahead'
          ? 'behind'
          : body.status === 'behind' || body.status === 'diverged'
            ? 'diverged'
            : 'unknown',
    behindBy: body.status === 'ahead' ? body.ahead_by || 0 : 0,
    latestSha: head ? head.slice(0, 7) : body.status === 'identical' ? sha : '',
    source: 'github',
  }
}

export async function checkForUpdate(opts: {
  buildStamp: string // __BUILD_SHA__ as baked, possibly '-dirty'-suffixed
  repoPath?: string // local source checkout (preferred comparison)
  repoSlug?: string // owner/repo for the GitHub API fallback
  runGit?: GitRunner // injectable for tests
  fetchImpl?: typeof fetch // injectable for tests
}): Promise<UpdateCheckResult> {
  const { sha, dirty } = parseBuildSha(opts.buildStamp)
  const base = { buildSha: sha, buildDirty: dirty, checkedAt: Date.now() }
  const unknown = (error?: string): UpdateCheckResult => ({
    ...base,
    status: 'unknown',
    behindBy: 0,
    latestSha: '',
    source: 'none',
    error,
  })
  if (!sha) return unknown('build sha not comparable (built outside git?)')
  try {
    if (opts.repoPath) {
      const run = opts.runGit || gitRunnerFor(opts.repoPath)
      const r = await checkViaLocalRepo(sha, opts.repoPath, run)
      if (r) return { ...base, ...r }
    }
    if (opts.repoSlug) {
      return { ...base, ...(await checkViaGitHub(sha, opts.repoSlug, opts.fetchImpl || fetch)) }
    }
  } catch (e) {
    return unknown(e instanceof Error ? e.message : String(e))
  }
  return unknown('no source checkout or repo slug to compare against')
}
