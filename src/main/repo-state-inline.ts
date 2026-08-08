// CANONICAL sidecar-state resolver for the standalone scripts.
//
// bin/terminal-cli, bin/terminal-cron and bin/terminal-mcp-server are separate
// processes that deliberately cannot import from the app bundle, so they each
// carry a copy of this logic. Hand-copying it is how three separate drift bugs
// got shipped, so the copies are now generated from this file and pinned
// byte-for-byte by src/main/repo-state-parity.test.ts.
//
// To change resolution: edit HERE, then run `bun run sync:repo-state`.
//
// Requires in scope: CFG, join, basename, existsSync, execFileSync, createHash.
// Mirrors src/main/repo-state.ts — including canonicalising the repo root via
// `rev-parse --show-toplevel` before hashing, so a path reached through a
// symlink (macOS /tmp -> /private/tmp) produces the same key in both.

export const REPO_STATE_BLOCK = `// --- BEGIN repo-state (canonical: src/main/repo-state-inline.ts — do not edit by hand) ---
/* eslint-disable @typescript-eslint/no-unused-vars -- one shared block; not every
   script uses every helper, and the copies must stay byte-identical. */
const SIDECAR_AREAS = ['backlog', 'sessions', 'reviews', 'checks', 'reports']
const repoStateKeyCache = new Map()
function repoStateDir() {
  return process.env.TERMINAL_REPO_STATE_DIR?.trim() || join(CFG, 'repos')
}
function gitOut(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}
// URL → host/path, mirroring src/main/repo.ts parseRemote: any scheme with an
// optional port (stripped — ssh://git@ssh.github.com:443/owner/repo must not
// yield "443/owner/repo"), else scp-like. Trailing slashes and .git dropped.
function parseRemoteKey(url) {
  const u = (url || '')
    .trim()
    .replace(/\\/+$/, '')
    .replace(/\\.git$/, '')
  const m =
    u.match(/^[a-z][a-z0-9+.-]*:\\/\\/(?:[^@/]+@)?([^/:]+)(?::\\d+)?\\/(.+)$/i) ||
    u.match(/^[\\w.-]+@([^:/]+)[:/](.+)$/)
  return m ? m[1] + '/' + m[2] : ''
}
// The key becomes a filesystem path under <config>/repos — a crafted origin
// URL must not traverse out of it.
function safeStateKey(key) {
  if (!key) return ''
  const parts = key.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return ''
  return key
}
function repoStateKey(root) {
  if (!root) return ''
  const hit = repoStateKeyCache.get(root)
  if (hit !== undefined) return hit
  // Raw configured URL first, exactly like src/main/repo.ts repoForCwd:
  // "remote get-url" applies url.<base>.insteadOf, which can rewrite a real
  // forge URL into an ssh alias or local mirror path that keys differently
  // (or not at all). The rewritten form stays as the fallback for the
  // opposite setup, where only the expanded URL names a repo.
  let key = safeStateKey(parseRemoteKey(gitOut(root, ['config', '--get', 'remote.origin.url'])))
  if (!key) key = safeStateKey(parseRemoteKey(gitOut(root, ['remote', 'get-url', 'origin'])))
  if (!key) {
    // No (usable) origin → hash the MAIN checkout's path, not the worktree's:
    // rev-parse --git-common-dir names the shared .git so every worktree of a
    // local-only repo lands on one sidecar, matching the origin-keyed case.
    let canonical = gitOut(root, ['rev-parse', '--show-toplevel']) || root
    const common = gitOut(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (common && common.endsWith('/.git')) canonical = common.slice(0, -'/.git'.length)
    const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 12)
    key = 'local/' + basename(canonical) + '-' + hash
  }
  repoStateKeyCache.set(root, key)
  return key
}
function sidecarAreaPath(root, area) {
  if (!root || !SIDECAR_AREAS.includes(area)) return ''
  const key = repoStateKey(root)
  return key ? join(repoStateDir(), key, area) : ''
}
// Reads merge sidecar + in-repo so state already committed stays visible;
// writes always go to the sidecar so a shared repo stops accreting state.
function areaPathsFor(root, area, candidates) {
  const out = []
  const sidecar = sidecarAreaPath(root, area)
  if (sidecar && existsSync(sidecar)) out.push(sidecar)
  for (const rel of candidates) {
    const p = join(root, rel)
    if (existsSync(p)) out.push(p)
  }
  return out
}
function areaWritePath(root, area, candidates, isV2) {
  const sidecar = sidecarAreaPath(root, area)
  if (sidecar) return sidecar
  const existing = areaPathsFor(root, area, candidates)
  if (existing.length) return existing[0]
  return join(root, isV2 ? candidates[0] : candidates[candidates.length - 1])
}
// IDs must be unique across EVERY dir an area reads from. A fresh sidecar
// beside a repo that still holds 0001-0042 would otherwise restart at 0001,
// producing two tickets with the same id and shadowing the originals.
function maxAreaId(dirs) {
  let max = 0
  for (const dir of dirs) {
    if (!dir) continue
    let entries = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of entries) {
      const m = /^(\\d{4})-/.exec(f)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  }
  return max
}
// Personal state files/dirs formerly at <repo>/.TerMinal/<rel>, now at the
// sidecar ROOT. Reads prefer the sidecar, fall back to the legacy in-repo
// copy; writes always target the sidecar. Mirrors repoStatePathForRead/Write.
function statePathForWrite(root, rel) {
  if (!root) return ''
  const key = repoStateKey(root)
  return key ? join(repoStateDir(), key, rel) : ''
}
function statePathForRead(root, rel) {
  const sidecar = statePathForWrite(root, rel)
  if (sidecar && existsSync(sidecar)) return sidecar
  const legacy = join(root, '.TerMinal', rel)
  if (existsSync(legacy)) return legacy
  return sidecar || legacy
}
// STICKY variant for live runtime dirs (loops/<id>): legacy wins while it
// exists, so an in-flight legacy loop never flips to a half-written sidecar
// copy mid-run. Mirrors repoStatePathSticky in src/main/repo-state.ts.
function statePathSticky(root, rel) {
  const legacy = join(root, '.TerMinal', rel)
  if (existsSync(legacy)) return legacy
  return statePathForWrite(root, rel) || legacy
}
// Env handed to a spawned agent/script: the same TERMINAL_<AREA>_DIR values
// the app injects, so a scheduled run resolves state identically to an
// interactive one. Scripts reference these instead of literal paths.
function repoStateEnv(root) {
  const out = {}
  if (!root) return out
  const key = repoStateKey(root)
  if (!key) return out
  const base = join(repoStateDir(), key)
  out.TERMINAL_STATE_DIR = base
  for (const area of SIDECAR_AREAS) {
    out['TERMINAL_' + area.toUpperCase() + '_DIR'] = join(base, area)
  }
  return out
}
/* eslint-enable @typescript-eslint/no-unused-vars */
// --- END repo-state ---`
