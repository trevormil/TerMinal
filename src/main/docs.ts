import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, basename, sep } from 'node:path'
import { existingProjectAreaPaths, type ProjectArea } from './project-layout'

// GitBook-style docs surface for a repo. Lists every markdown file under
// docs/ + reports/checks + a root CHANGELOG.md, grouped by category for the
// renderer's sidebar.
//
// Categories (per project-template convention):
//   - changelog   — root CHANGELOG.md only (pinned)
//   - decisions   — docs/decisions/**.md (ADRs)
//   - maintainer  — docs/maintainer/**.md (auto-docs agent)
//   - developer   — docs/developer/**.md  (auto-docs agent)
//   - personal    — docs/personal/**.md   (auto-docs agent)
//   - reports     — reports/<kind>/**.md or .TerMinal/reports/<kind>/**.md
//                   (scheduled-agent run artifacts;
//                   each kind sub-grouped in the sidebar via DocEntry.subgroup)
//   - other       — everything else under docs/**.md (human-authored runbooks,
//                   architecture.md at root, etc.)

export type DocCategory =
  'changelog' | 'decisions' | 'maintainer' | 'developer' | 'personal' | 'reports' | 'other'

export type DocEntry = {
  path: string // relative to repoRoot, forward slashes
  title: string // first H1 or filename basename
  category: DocCategory
  managedBy?: string // agent name if a "managed by:" header is present
  subgroup?: string // for 'reports': the agent name (second path segment)
}

export type DocsTree = {
  categories: { id: DocCategory; label: string; items: DocEntry[] }[]
}

const CATEGORY_LABEL: Record<DocCategory, string> = {
  changelog: 'Changelog',
  decisions: 'Decisions',
  maintainer: 'Maintainer',
  developer: 'Developer',
  personal: 'Personal',
  reports: 'Reports',
  other: 'Other',
}

// Order in the sidebar.
const CATEGORY_ORDER: DocCategory[] = [
  'changelog',
  'decisions',
  'maintainer',
  'developer',
  'personal',
  'reports',
  'other',
]

const MARKDOWN_RE = /\.(md|mdx|markdown)$/i
const MANAGED_BY_RE = /<!--\s*managed by:\s*([a-z0-9-]+)/i

function readTitle(content: string, fallback: string): string {
  const h1 = content.match(/^#\s+(.+?)\s*$/m)
  if (h1) return h1[1].trim()
  return fallback
}

function categorize(rel: string): DocCategory {
  const norm = rel.split(sep).join('/')
  if (norm === 'CHANGELOG.md') return 'changelog'
  if (norm.startsWith('docs/decisions/')) return 'decisions'
  if (norm.startsWith('docs/maintainer/')) return 'maintainer'
  if (norm.startsWith('docs/developer/')) return 'developer'
  if (norm.startsWith('docs/personal/')) return 'personal'
  if (norm.startsWith('reports/')) return 'reports'
  if (norm.startsWith('.checks/')) return 'reports'
  if (norm.startsWith('checks/')) return 'reports' // checks/ surfaces alongside reports/
  if (norm.startsWith('.TerMinal/reports/')) return 'reports'
  if (norm.startsWith('.TerMinal/checks/')) return 'reports'
  return 'other'
}

function reportSubgroup(rel: string): string | undefined {
  const parts = rel.split(sep).join('/').split('/')
  // reports/<kind>/<file>.md              → "<kind>"
  // .TerMinal/reports/<kind>/<file>.md    → "<kind>"
  // .checks/<kind>/<file>.md              → "<kind>"
  // checks/<kind>/<file>.md               → "<kind>"
  // .TerMinal/checks/<kind>/<file>.md     → "<kind>"
  if (parts.length >= 3 && (parts[0] === 'reports' || parts[0] === 'checks')) return parts[1]
  if (parts.length >= 3 && parts[0] === '.checks') return parts[1]
  if (
    parts.length >= 4 &&
    parts[0] === '.TerMinal' &&
    (parts[1] === 'reports' || parts[1] === 'checks')
  )
    return parts[2]
  return undefined
}

function walk(root: string, dir: string, out: string[]): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(root, full, out)
    else if (st.isFile() && MARKDOWN_RE.test(name)) out.push(relative(root, full))
  }
}

export function listDocs(repoRoot: string): DocsTree {
  const empty: DocsTree = {
    categories: CATEGORY_ORDER.map((id) => ({ id, label: CATEGORY_LABEL[id], items: [] })),
  }
  if (!repoRoot || !existsSync(repoRoot)) return empty
  // rel = the CANONICAL path shown/categorized/fetched; abs = where it lives.
  // Area dirs can resolve to the sidecar (outside the repo), where a
  // repo-relative path would be `../../…` — matching no category and failing
  // readDoc's traversal guard. So area files are keyed area-relative
  // (`reports/<kind>/x.md`) regardless of which root they came from, and
  // readDoc resolves those aliases through the same area candidates.
  const paths: { rel: string; abs: string }[] = []
  const collect = (base: string, alias: string) => {
    if (!existsSync(base) || !statSync(base).isDirectory()) return
    const rels: string[] = []
    walk(base, base, rels)
    for (const r of rels) {
      const norm = r.split(sep).join('/')
      paths.push({ rel: alias ? `${alias}/${norm}` : norm, abs: join(base, r) })
    }
  }
  const docsDir = join(repoRoot, 'docs')
  collect(docsDir, 'docs')
  for (const reportsDir of existingProjectAreaPaths(repoRoot, 'reports'))
    collect(reportsDir, 'reports')
  for (const checksDir of existingProjectAreaPaths(repoRoot, 'checks')) collect(checksDir, 'checks')
  const changelog = join(repoRoot, 'CHANGELOG.md')
  if (existsSync(changelog)) paths.push({ rel: 'CHANGELOG.md', abs: changelog })

  const entries: DocEntry[] = []
  const seen = new Set<string>()
  for (const { rel, abs } of paths) {
    const norm = rel
    // Areas merge several roots (sidecar + legacy); first root wins per rel so
    // the Docs list never shows the same report twice.
    if (seen.has(norm)) continue
    seen.add(norm)
    let content = ''
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      /* skip */
    }
    const managed = content.match(MANAGED_BY_RE)
    const category = categorize(norm)
    entries.push({
      path: norm,
      title: readTitle(content, basename(norm, '.md')),
      category,
      managedBy: managed ? managed[1] : undefined,
      subgroup: category === 'reports' ? reportSubgroup(norm) : undefined,
    })
  }

  const byCategory = new Map<DocCategory, DocEntry[]>()
  for (const e of entries) {
    const list = byCategory.get(e.category) ?? []
    list.push(e)
    byCategory.set(e.category, list)
  }
  for (const list of byCategory.values()) list.sort((a, b) => a.path.localeCompare(b.path))

  return {
    categories: CATEGORY_ORDER.map((id) => ({
      id,
      label: CATEGORY_LABEL[id],
      items: byCategory.get(id) ?? [],
    })),
  }
}

// Path-guarded read: markdown only, and only inside repoRoot — or, for the
// `reports/` and `checks/` aliases listDocs emits, inside one of that area's
// resolved roots (which may be the sidecar, outside the repo).
export function readDoc(repoRoot: string, relPath: string): string {
  if (!repoRoot || !relPath) return ''
  if (!MARKDOWN_RE.test(relPath)) return ''
  const parts = relPath.split('/')
  if (parts[0] === 'reports' || parts[0] === 'checks') {
    const rest = parts.slice(1).join(sep)
    for (const base of existingProjectAreaPaths(repoRoot, parts[0] as ProjectArea)) {
      const full = join(base, rest)
      if (!full.startsWith(base + sep)) return '' // traversal inside the alias
      try {
        return readFileSync(full, 'utf8')
      } catch {
        /* not in this root — try the next */
      }
    }
    return ''
  }
  const norm = relPath.split('/').join(sep)
  const full = join(repoRoot, norm)
  // prevent path traversal
  if (!full.startsWith(repoRoot + sep) && full !== join(repoRoot, basename(norm))) return ''
  try {
    return readFileSync(full, 'utf8')
  } catch {
    return ''
  }
}
