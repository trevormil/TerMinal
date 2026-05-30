export function rewriteCodexSkillSubmit(line: string, skillNames: Set<string>): string | null {
  const m = line.match(/^\/([A-Za-z][\w-]*)(?:\s+([\s\S]*))?$/)
  if (!m || !skillNames.has(m[1])) return null
  return `$${m[1]}${m[2] ? ` ${m[2]}` : ''}\r`
}
