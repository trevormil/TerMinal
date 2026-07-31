import { readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { IpcMain } from 'electron'
import { writeJsonAtomic } from '../atomic-write'

// ---------------------------------------------------------------------------
// The "no, and stop asking" half of repo trust.
//
// src/main/repo-trust.ts records APPROVAL. It has no notion of refusal: not
// approved and actively refused look identical, so the pending-approval badge
// this module backs would light up again on every attach to a repo the user has
// already said no to. That trains people to click things to make a badge go
// away, which is the exact reflex the trust gate exists to prevent.
//
// So refusal is recorded, and keyed on (repo root, command-set hash) exactly
// like approval. Same consequence: a repo that CHANGES its commands is a new
// decision and prompts again — a denial is not a permanent mute on a file the
// repo can rewrite. Only the set you actually read stays denied.
// ---------------------------------------------------------------------------

export type DenialRecord = { hash: string; deniedAt: number }
export type DenialStore = Record<string, DenialRecord>

export const DENIAL_FILE = join(homedir(), '.config', 'TerMinal', 'repo-trust-denials.json')

export function readDenialStore(file: string = DENIAL_FILE): DenialStore {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: DenialStore = {}
    for (const [root, rec] of Object.entries(raw as Record<string, unknown>)) {
      const r = rec as Partial<DenialRecord>
      if (r && typeof r.hash === 'string') {
        out[root] = { hash: r.hash, deniedAt: Number(r.deniedAt) || 0 }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function writeDenialStore(store: DenialStore, file: string = DENIAL_FILE): void {
  mkdirSync(dirname(file), { recursive: true })
  writeJsonAtomic(file, store)
}

/** True only for the exact command set that was refused. */
export function isRepoDenied(store: DenialStore, repoRoot: string, hash: string): boolean {
  if (!repoRoot || !hash) return false
  return store[repoRoot]?.hash === hash
}

export function denyRepo(
  store: DenialStore,
  repoRoot: string,
  hash: string,
  now = Date.now(),
): DenialStore {
  if (!repoRoot || !hash) return store
  return { ...store, [repoRoot]: { hash, deniedAt: now } }
}

export function undenyRepo(store: DenialStore, repoRoot: string): DenialStore {
  if (!(repoRoot in store)) return store
  const out = { ...store }
  delete out[repoRoot]
  return out
}

/**
 * Registers `repoTrust:denied` / `repoTrust:deny` / `repoTrust:undeny`.
 *
 * Unlike `repoTrust:approve`, these take (repoRoot, hash) from the renderer
 * rather than resolving the active session's cwd in main. That asymmetry is
 * deliberate and safe in one direction only: denying is a REVOCATION of
 * capability. The worst a compromised renderer achieves by calling deny() with
 * an arbitrary path is silencing a prompt for a repo whose widgets then stay
 * off — it cannot grant execution anywhere. Approval keeps its no-argument
 * form precisely because that direction does grant it.
 */
export function registerRepoTrustDenialIpc(ipcMain: IpcMain, file: string = DENIAL_FILE): void {
  ipcMain.handle('repoTrust:denied', (_e, repoRoot: string, hash: string) =>
    isRepoDenied(readDenialStore(file), String(repoRoot || ''), String(hash || '')),
  )
  ipcMain.handle('repoTrust:deny', (_e, repoRoot: string, hash: string) => {
    const root = String(repoRoot || '')
    const h = String(hash || '')
    if (!root || !h) return false
    writeDenialStore(denyRepo(readDenialStore(file), root, h), file)
    return true
  })
  ipcMain.handle('repoTrust:undeny', (_e, repoRoot: string) => {
    const root = String(repoRoot || '')
    if (!root) return false
    writeDenialStore(undenyRepo(readDenialStore(file), root), file)
    return true
  })
}
