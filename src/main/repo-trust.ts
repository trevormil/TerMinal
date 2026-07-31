import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { writeJsonAtomic } from './atomic-write'

// ---------------------------------------------------------------------------
// Per-repo trust for REPO-SOURCED command widgets and tabs.
//
// `.TerMinal/widgets.json` and `.TerMinal/tabs.json` come from whatever repo you
// happen to open a session in. Before this module, cloning a repo and attaching
// a session was enough to run its commands on a poll interval, unattended — the
// README's "same trust model as npm scripts" undersold it, because npm scripts
// at least require you to type `npm run`.
//
// So: repo-sourced commands are inert until the user approves THAT repo for THAT
// exact set of commands. The approval is keyed on (repo root, hash of the
// command set), so editing widgets.json — or a `git pull` that changes it —
// revokes the approval and re-prompts, showing the literal new commands.
//
// GLOBAL widgets/tabs (~/.config/TerMinal/*.json) are the user's own files and
// are deliberately untouched by any of this.
// ---------------------------------------------------------------------------

export type TrustRecord = { hash: string; approvedAt: number }
export type TrustStore = Record<string, TrustRecord>

export const TRUST_FILE = join(homedir(), '.config', 'TerMinal', 'repo-trust.json')

/**
 * Stable fingerprint of everything a repo would execute or embed. Order-
 * independent (a reordered widgets.json is not a new decision to make) but
 * content-sensitive: changing one character of one command invalidates the
 * approval.
 */
export function commandSetHash(commands: string[]): string {
  const norm = [...new Set(commands.map((c) => String(c)))].sort()
  // JSON.stringify of the ARRAY, not a joined string: any separator can also
  // occur inside a command (a space obviously; even NUL is expressible in JSON
  // as \u0000), so joining is ambiguous — ['a b', 'c'] and ['a', 'b c'] could
  // fingerprint identically and one approved command set would authorise a
  // different one. Encoding the array structure removes the question entirely.
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 16)
}

export function readTrustStore(file: string = TRUST_FILE): TrustStore {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: TrustStore = {}
    for (const [root, rec] of Object.entries(raw as Record<string, unknown>)) {
      const r = rec as Partial<TrustRecord>
      if (r && typeof r.hash === 'string') {
        out[root] = { hash: r.hash, approvedAt: Number(r.approvedAt) || 0 }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function writeTrustStore(store: TrustStore, file: string = TRUST_FILE): void {
  mkdirSync(dirname(file), { recursive: true })
  writeJsonAtomic(file, store)
}

/** An empty command set is nothing to approve — treat it as trusted so a repo
 *  with no widgets never shows a prompt. */
export function isRepoTrusted(store: TrustStore, repoRoot: string, hash: string): boolean {
  if (!repoRoot) return false
  if (hash === commandSetHash([])) return true
  return store[repoRoot]?.hash === hash
}

export function approveRepo(
  store: TrustStore,
  repoRoot: string,
  hash: string,
  now = Date.now(),
): TrustStore {
  if (!repoRoot) return store
  return { ...store, [repoRoot]: { hash, approvedAt: now } }
}

export function revokeRepo(store: TrustStore, repoRoot: string): TrustStore {
  if (!(repoRoot in store)) return store
  const out = { ...store }
  delete out[repoRoot]
  return out
}
