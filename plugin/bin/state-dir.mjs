// Where a repo's workflow state lives, for the bun helpers in this directory.
//
// Three of them (code-review-preflight, compute-verdict, findings-merge) each
// carried their own copy of the same rule, and all three had the same bug: if
// the repo contained `.reviews/` and no v2 marker they wrote the review
// artifact back into the checkout. Every repo predating the sidecar matches
// that, so the "state is not in the repo" guarantee held everywhere except the
// repos anyone actually used. One copy now, and it does not have that branch.
//
// state-path-ok: this module IS the resolver — naming the areas is its job.

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Absolute directory for a state area. Prefers the value TerMinal injected
 * into the session; otherwise asks tm-state-dir, which derives it the same way
 * src/main/repo-state.ts does.
 *
 * @param {'backlog'|'sessions'|'reviews'|'checks'|'reports'} area
 * @returns {string} absolute path
 */
export function stateDir(area) {
  const injected = process.env[`TERMINAL_${area.toUpperCase()}_DIR`]?.trim()
  if (injected) return injected
  return execFileSync(join(HERE, 'tm-state-dir'), [area], { encoding: 'utf8' }).trim()
}

/**
 * Every directory the area may be READ from, highest priority first — the
 * sidecar plus anything a repo has not migrated yet. Only existing dirs.
 *
 * @param {'backlog'|'sessions'|'reviews'|'checks'|'reports'} area
 * @returns {string[]}
 */
export function stateDirs(area) {
  return execFileSync(join(HERE, 'tm-state-dirs'), [area], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}
