// Line-pinned review comments, batched into one revision prompt (0049 —
// Orca's strongest idea). Comments remember the line's TEXT, not just its
// number, so they can re-anchor after the agent's next editing pass.

export type ReviewComment = {
  file: string
  /** 1-based line the comment was made on (at the time). */
  line: number
  /** The line's text when the comment was made — the re-anchor key. */
  text: string
  note: string
}

/**
 * Where a comment's line lives NOW: the exact-text match nearest the original
 * line number, or null when the line is gone (the comment is stale).
 */
export function reanchorLine(
  comment: Pick<ReviewComment, 'line' | 'text'>,
  lines: string[],
): number | null {
  const want = comment.text.trim()
  if (!want) return comment.line <= lines.length ? comment.line : null
  let best: number | null = null
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== want) continue
    const n = i + 1
    if (best === null || Math.abs(n - comment.line) < Math.abs(best - comment.line)) best = n
  }
  return best
}

/** Every comment as ONE revision prompt an agent can act on directly. */
export function buildRevisionPrompt(comments: ReviewComment[]): string {
  const lines = [
    'Please revise your changes to address the following review comments.',
    'Each is pinned to a file and line:',
    '',
  ]
  for (const c of comments) {
    lines.push(`- ${c.file}:${c.line} — ${c.note}`)
    if (c.text.trim()) lines.push(`  > ${c.text.trim()}`)
  }
  lines.push('', 'Address every comment; keep unrelated code untouched.')
  return lines.join('\n')
}
