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

export const REPO_STATE_BLOCK = `// --- BEGIN repo-state (canonical: src/main/repo-state-inline.js — do not edit by hand) ---
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
function repoStateKey(root) {
  if (!root) return ''
  const hit = repoStateKeyCache.get(root)
  if (hit !== undefined) return hit
  let key = ''
  const url = gitOut(root, ['remote', 'get-url', 'origin']).replace(/\\.git$/, '')
  if (url) {
    let m = url.match(/^https?:\\/\\/(?:[^@/]+@)?([^/]+)\\/(.+)$/)
    if (!m) m = url.match(/^(?:ssh:\\/\\/)?[\\w.-]+@([^:/]+)[:/](.+)$/)
    if (m) key = m[1] + '/' + m[2]
  }
  if (!key) {
    const canonical = gitOut(root, ['rev-parse', '--show-toplevel']) || root
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
// --- END repo-state ---`
