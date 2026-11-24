export function normalizeKnowledgePath(input: unknown): string | null {
  if (
    typeof input !== 'string' ||
    !input ||
    /[\\\x00-\x1f]/.test(input) ||
    input.startsWith('/') ||
    /^[A-Za-z]:/.test(input)
  )
    return null
  const parts = input.split('/').filter((p) => p && p !== '.')
  if (!parts.length || parts.includes('..')) return null
  return parts.join('/')
}
