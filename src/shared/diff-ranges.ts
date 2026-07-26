// Parse `git diff --unified=0` output into per-file changed line ranges in
// the NEW version. Used to attribute the lines an agent turn touched (the
// checkpoint commit vs its parent) without shipping a diff library.

export type LineRange = { from: number; to: number }

/** Sort + coalesce overlapping/adjacent ranges. */
export function mergeLineRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from)
  const out: LineRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to)
    else out.push({ ...r })
  }
  return out
}

/** file → 1-based inclusive line ranges added/changed in the new version. */
export function parseUnifiedRanges(diff: string): Record<string, LineRange[]> {
  const out: Record<string, LineRange[]> = {}
  let file = ''
  for (const line of diff.split('\n')) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line)
    if (f) {
      file = f[1]
      continue
    }
    if (line.startsWith('+++ /dev/null')) {
      file = '' // deletion — nothing to attribute in the new version
      continue
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!h || !file) continue
    const start = Number(h[1])
    const count = h[2] === undefined ? 1 : Number(h[2])
    if (count === 0) continue // pure deletion hunk
    if (!out[file]) out[file] = []
    out[file].push({ from: start, to: start + count - 1 })
  }
  return out
}
