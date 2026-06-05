export type HeavyDiffFile = {
  path: string
  added: number
  deleted: number
  binary: boolean
}

export type HeavyDiffResult = {
  heavy: boolean
  reason: string
  files: HeavyDiffFile[]
  lineCount: number
}

const DEFAULT_LINE_THRESHOLD = 500
const RISKY_PATHS = [
  /(^|\/)auth(\/|[.-]|$)/i,
  /(^|\/)security(\/|[.-]|$)/i,
  /(^|\/)payments?(\/|[.-]|$)/i,
  /(^|\/)billing(\/|[.-]|$)/i,
  /(^|\/)deploy(\/|[.-]|$)/i,
  /(^|\/)deployment(s)?(\/|[.-]|$)/i,
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)(k8s|kubernetes|helm|terraform)\//i,
  /(^|\/)config(\/|[.-]|$)/i,
  /\.ya?ml$/i,
  /\.tf$/i,
  /\.env(\.|$)/i,
]
const DOC_PATHS = [
  /\.mdx?$/i,
  /\.markdown$/i,
  /(^|\/)docs?\//i,
  /(^|\/)README(\.|$)/i,
  /(^|\/)CHANGELOG\.md$/i,
]

function isRiskyPath(path: string): boolean {
  return RISKY_PATHS.some((re) => re.test(path))
}

function isDocsPath(path: string): boolean {
  return DOC_PATHS.some((re) => re.test(path))
}

export function parseNumstat(numstat: string): HeavyDiffFile[] {
  const files: HeavyDiffFile[] = []
  for (const raw of numstat.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(/\t+/)
    if (parts.length < 3) continue
    const [addedRaw, deletedRaw, ...pathParts] = parts
    const path = pathParts.join('\t').trim()
    if (!path) continue
    const binary = addedRaw === '-' || deletedRaw === '-'
    const added = binary ? 0 : Number(addedRaw)
    const deleted = binary ? 0 : Number(deletedRaw)
    if (!binary && (!Number.isFinite(added) || !Number.isFinite(deleted))) continue
    files.push({ path, added, deleted, binary })
  }
  return files
}

export function classifyHeavyDiff(
  numstat: string,
  opts: { lineThreshold?: number } = {},
): HeavyDiffResult {
  const files = parseNumstat(numstat)
  const lineCount = files.reduce((sum, f) => sum + f.added + f.deleted, 0)
  if (!files.length) return { heavy: false, reason: 'empty diff', files, lineCount }

  const risky = files.find((f) => isRiskyPath(f.path))
  if (risky) return { heavy: true, reason: `risky path: ${risky.path}`, files, lineCount }

  const threshold = opts.lineThreshold ?? DEFAULT_LINE_THRESHOLD
  if (lineCount > threshold) return { heavy: true, reason: `large diff: ${lineCount} lines`, files, lineCount }

  if (files.every((f) => isDocsPath(f.path))) {
    return { heavy: false, reason: 'docs-only diff', files, lineCount }
  }

  return { heavy: false, reason: `below threshold: ${lineCount} lines`, files, lineCount }
}
