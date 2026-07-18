import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Template-provenance stamp (ticket 0045). Every path that copies
// project-template files into a repo (initial scaffold + bootstrap.sh repair)
// records WHICH template version it copied, so later features can diff
// "bootstrapped at SHA X" against template HEAD to offer targeted upgrades.
// Lives in .TerMinal/meta.json — repo-local state, tracked like template.json
// (the .gitignore convention only excludes locks/per-machine files).

export type BootstrapStamp = { sha: string; stampedAt: string }

// Baked by electron.vite.config.ts `define` — the template submodule's HEAD at
// build time. The typeof guard keeps bare `bun test` (no vite define) working.
declare const __TEMPLATE_SHA__: string
export function bakedTemplateSha(): string {
  return typeof __TEMPLATE_SHA__ === 'string' ? __TEMPLATE_SHA__ : 'unknown'
}

/** HEAD sha of the template checkout actually copied (local submodule or tmp
 *  clone — both are git repos). Falls back to the build-time baked sha when
 *  git can't answer (deleted .git, missing binary). */
export function resolveTemplateSha(templateDir: string, fallback: string): string {
  if (!templateDir) return fallback
  try {
    return (
      execFileSync('git', ['-C', templateDir, 'rev-parse', 'HEAD'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
      })
        .toString()
        .trim() || fallback
    )
  } catch {
    return fallback
  }
}

/** Merge `lastBootstrapVersion` into .TerMinal/meta.json (created if missing).
 *  Overwrites any previous stamp — it reflects the LAST bootstrap. Unrelated
 *  keys and a malformed existing file are handled without crashing. */
export function writeBootstrapStamp(repoRoot: string, stamp: BootstrapStamp): void {
  if (!repoRoot) throw new Error('writeBootstrapStamp: repoRoot required')
  const dir = join(repoRoot, '.TerMinal')
  const file = join(dir, 'meta.json')
  let meta: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed
  } catch {
    /* missing or malformed — start fresh */
  }
  meta.lastBootstrapVersion = stamp
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(meta, null, 2) + '\n')
}
