export type GitGutterLine = { line: number; kind: 'added' | 'modified' | 'deleted' }

export function gitGutterLines(patch: string, lineCount: number): GitGutterLine[] {
  const marks = new Map<number, GitGutterLine['kind']>()
  let next = 0
  let removed = 0
  let inHunk = false
  const flush = () => {
    if (removed && lineCount > 0) {
      const line = Math.max(1, Math.min(next, lineCount))
      if (!marks.has(line)) marks.set(line, 'deleted')
    }
    removed = 0
  }
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      flush()
      next = Number(hunk[1])
      inHunk = true
    } else if (text.startsWith('diff --git ')) {
      flush()
      inHunk = false
    } else if (inHunk && text.startsWith('-')) {
      removed++
    } else if (inHunk && text.startsWith('+')) {
      if (next >= 1 && next <= lineCount) marks.set(next, removed ? 'modified' : 'added')
      if (removed) removed--
      next++
    } else if (inHunk && text.startsWith(' ')) {
      flush()
      next++
    }
  }
  flush()
  return [...marks].sort(([a], [b]) => a - b).map(([line, kind]) => ({ line, kind }))
}
