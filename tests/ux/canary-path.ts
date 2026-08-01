import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the pre-suite fingerprint is parked between the setup and check
 *  projects. Under test-results/ (gitignored, per-checkout) rather than
 *  /tmp, so two concurrent runs in different worktrees cannot collide. */
export const CANARY_STAMP = join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'test-results',
  'canary-fingerprint.txt',
)
