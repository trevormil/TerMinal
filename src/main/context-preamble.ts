import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

export type ContextPreambleItem = {
  path: string
  title: string
  summary: string
}

const DEFAULT_MAX_ITEMS = 6
const DEFAULT_MAX_BYTES = 1800
const CONTEXT_DIRS = ['docs/learnings', 'docs/decisions', 'docs/runbooks'] as const
const PLACEHOLDER_DOC = /(^|\/)(readme|index)\.mdx?$/i

function markdownFiles(dir: string, root: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const abs = join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) markdownFiles(abs, root, out)
    else if (/\.mdx?$/i.test(name)) {
      const rel = relative(root, abs).split('/').join('/')
      if (!PLACEHOLDER_DOC.test(rel)) out.push(abs)
    }
  }
  return out
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
}

function titleFrom(path: string, body: string): string {
  const heading = body.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim()
  if (heading) return heading
  return basename(path)
    .replace(/\.mdx?$/i, '')
    .replace(/[-_]+/g, ' ')
}

function summaryFrom(body: string): string {
  for (const raw of stripFrontmatter(body).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line === '---') continue
    return line.replace(/\s+/g, ' ').slice(0, 220)
  }
  return ''
}

export function collectAgentContextItems(
  repoRoot: string,
  maxItems = DEFAULT_MAX_ITEMS,
): ContextPreambleItem[] {
  if (!repoRoot) return []
  const files = CONTEXT_DIRS.flatMap((dir) => markdownFiles(join(repoRoot, dir), repoRoot)).sort()
  const items: ContextPreambleItem[] = []
  for (const file of files) {
    let body = ''
    try {
      body = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const summary = summaryFrom(body)
    if (!summary) continue
    items.push({
      path: relative(repoRoot, file).split('/').join('/'),
      title: titleFrom(file, body),
      summary,
    })
    if (items.length >= maxItems) break
  }
  return items
}

export function buildAgentContextPreamble(
  repoRoot: string,
  opts: { maxItems?: number; maxBytes?: number } = {},
): string {
  const maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const items = collectAgentContextItems(repoRoot, maxItems)
  if (!items.length) return ''

  const lines = [
    'Prior context from this repo. Use it to avoid repeating known mistakes:',
    ...items.map((item) => `- ${item.title} (${item.path}): ${item.summary}`),
  ]
  let out = `${lines.join('\n')}\n\n`
  while (Buffer.byteLength(out, 'utf8') > maxBytes && lines.length > 1) {
    lines.pop()
    out = `${lines.join('\n')}\n\n`
  }
  return Buffer.byteLength(out, 'utf8') <= maxBytes ? out : ''
}

export function withAgentContextPreamble(
  repoRoot: string,
  prompt: string,
  enabled: boolean,
): string {
  if (!enabled) return prompt
  const preamble = buildAgentContextPreamble(repoRoot)
  return preamble ? `${preamble}${prompt}` : prompt
}
