import { isAbsolute, resolve, sep } from 'node:path'

/**
 * Resolve `rel` against `root`, returning null unless the result is genuinely
 * inside `root`.
 *
 * The trap this closes: `join(root, rel).startsWith(root)` is a STRING prefix
 * test, not a path-boundary test. With root `/tmp/repo`, a renderer-supplied
 * `../repo-private/secrets.env` normalises to `/tmp/repo-private/secrets.env`,
 * which starts with `/tmp/repo` and passes — so a sibling directory that merely
 * shares the root's name prefix is reachable. Comparing against `root + sep`
 * (and allowing the root itself) is what makes it a real boundary.
 *
 * The same pattern already guards repo-allowlist.ts and workflow-files.ts;
 * this is the shared, tested version for anything renderer-supplied.
 */
export function resolveWithin(root: string, rel: string): string | null {
  if (!root || typeof root !== 'string' || typeof rel !== 'string') return null
  // Resolve the root too: a relative or unnormalised root would otherwise make
  // the comparison below meaningless.
  const base = resolve(root)
  // Callers hand us workspace-RELATIVE paths (the same values files:list hands
  // out). An absolute one is never legitimate, and path.resolve would silently
  // let it replace the root entirely, so refuse rather than reinterpret it.
  if (isAbsolute(rel)) return null
  const abs = resolve(base, rel)
  if (abs !== base && !abs.startsWith(base + sep)) return null
  return abs
}
