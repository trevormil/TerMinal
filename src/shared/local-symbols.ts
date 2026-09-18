export function symbolAt(source: string, cursor: number): string {
  const left = source.slice(0, cursor).match(/[\w$]+$/)?.[0] || ''
  const right = source.slice(cursor).match(/^[\w$]+/)?.[0] || ''
  const name = left + right
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : ''
}

export function localDefinitions(source: string, query: string) {
  const hits: { name: string; line: number; offset: number }[] = []
  let offset = 0
  let block = false
  for (const [index, line] of source.split('\n').entries()) {
    const trimmed = line.trimStart()
    const skip =
      block || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')
    if (trimmed.startsWith('/*')) block = true
    if (line.includes('*/')) block = false
    const match =
      !skip &&
      line.match(
        /^\s*(?:(?:export|default|declare|public|private|static|async)\s+)*(?:function\s*\*?|class|const|let|var|type|interface|enum|def|fn|struct)\s+([A-Za-z_$][\w$]*)/,
      )
    if (match && (!query.trim() || match[1] === query.trim())) {
      hits.push({
        name: match[1],
        line: index + 1,
        offset: offset + match[0].lastIndexOf(match[1]),
      })
    }
    offset += line.length + 1
  }
  return hits
}

export function definitionSelection(
  source: string,
  hit: { name: string; line: number },
): { anchor: number; head: number } | null {
  const current = localDefinitions(source, hit.name).find((item) => item.line === hit.line)
  return current ? { anchor: current.offset, head: current.offset + current.name.length } : null
}

export type FileSymbolSearchResult = {
  hits: { path: string; name: string; line: number; offset: number }[]
  scanned: number
  skipped: number
  truncated: boolean
  error?: string
}
