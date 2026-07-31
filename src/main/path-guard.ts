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

/**
 * The ABSOLUTE-path counterpart of `resolveWithin`, for sinks whose renderer
 * callers legitimately hand out absolute paths (`open:in-editor` is handed an
 * agent script path, a note file, a RAG root — all absolute, from several
 * different roots). Returns the normalised path if it sits inside ANY of
 * `roots`, else null.
 *
 * Same boundary rule as `resolveWithin` (`root + sep`, root itself allowed) —
 * a string `startsWith` would let `/Users/me/Projects-private` pass for root
 * `/Users/me/Projects`. Empty/falsy roots are ignored rather than treated as
 * `/`, so a caller with no active workspace can't accidentally allow everything.
 */
export function resolveWithinAny(
  roots: (string | undefined | null)[],
  target: string,
): string | null {
  if (typeof target !== 'string' || !isAbsolute(target)) return null
  const abs = resolve(target)
  for (const root of roots) {
    if (!root || typeof root !== 'string') continue
    const base = resolve(root)
    if (abs === base || abs.startsWith(base + sep)) return abs
  }
  return null
}
