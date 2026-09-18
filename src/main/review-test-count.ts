export function recordedFailCount(markdown: string): number | null {
  const normalized = markdown.replace(/\r\n/g, '\n')
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]
  const counts = frontmatter?.match(/^test_counts:[ \t]*\n((?:[ \t]+[^\n]*\n?)*)/m)?.[1]
  const section = normalized.match(/^## Test gate[ \t]*\n([\s\S]*?)(?=^#{1,3} |$(?![\s\S]))/m)?.[1]
  const raw =
    counts?.match(/^  failed: (\d+)[ \t]*$/m)?.[1] ?? section?.match(/^- fail: (\d+)[ \t]*$/m)?.[1]
  if (raw === undefined) return null
  const count = Number(raw)
  return Number.isSafeInteger(count) ? count : null
}
