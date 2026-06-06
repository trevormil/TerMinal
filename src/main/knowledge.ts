import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type KnowledgeScope = 'repo' | 'global'
export type KnowledgeItemKind = 'markdown' | 'link' | 'image' | 'video' | 'file'
export type KnowledgeCategory = {
  id: string
  title: string
  description?: string
  order: number
  createdAt: number
  updatedAt: number
}
export type KnowledgeItem = {
  id: string
  categoryId: string
  kind: KnowledgeItemKind
  title: string
  description?: string
  content?: string
  url?: string
  path?: string
  tags: string[]
  createdAt: number
  updatedAt: number
}
export type KnowledgeBase = {
  version: 1
  categories: KnowledgeCategory[]
  items: KnowledgeItem[]
}

const GLOBAL = join(homedir(), '.config', 'TerMinal', 'knowledge.json')
const repoKnowledgePath = (repoRoot: string) => join(repoRoot, '.TerMinal', 'knowledge.json')

const now = () => Date.now()
const slug = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item'

const defaultBase = (): KnowledgeBase => ({
  version: 1,
  categories: [
    {
      id: 'general',
      title: 'General',
      description: 'Links, notes, and references that do not need a dedicated category yet.',
      order: 0,
      createdAt: now(),
      updatedAt: now(),
    },
  ],
  items: [],
})

function pathFor(scope: KnowledgeScope, repoRoot: string): string {
  return scope === 'global' ? GLOBAL : repoRoot ? repoKnowledgePath(repoRoot) : ''
}

function uniqueId(base: string, seen: Set<string>): string {
  let id = slug(base)
  let i = 2
  while (seen.has(id)) id = `${slug(base)}-${i++}`
  seen.add(id)
  return id
}

export function migrateKnowledge(raw: unknown): KnowledgeBase {
  const fallback = defaultBase()
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as Record<string, unknown>
  const categorySeen = new Set<string>()
  const categories = Array.isArray(r.categories)
    ? r.categories
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x, i) => {
          const title = typeof x.title === 'string' && x.title.trim() ? x.title.trim() : 'Category'
          const id = uniqueId(typeof x.id === 'string' ? x.id : title, categorySeen)
          const ts = typeof x.createdAt === 'number' ? x.createdAt : now()
          return {
            id,
            title,
            description: typeof x.description === 'string' ? x.description : '',
            order: typeof x.order === 'number' ? x.order : i,
            createdAt: ts,
            updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : ts,
          } satisfies KnowledgeCategory
        })
    : fallback.categories
  if (!categories.length) categories.push(...fallback.categories)
  const validCategories = new Set(categories.map((c) => c.id))
  const itemSeen = new Set<string>()
  const items = Array.isArray(r.items)
    ? r.items
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => {
          const title = typeof x.title === 'string' && x.title.trim() ? x.title.trim() : 'Untitled'
          const kind: KnowledgeItemKind =
            x.kind === 'link' || x.kind === 'image' || x.kind === 'video' || x.kind === 'file' || x.kind === 'markdown'
              ? x.kind
              : 'markdown'
          const categoryId =
            typeof x.categoryId === 'string' && validCategories.has(x.categoryId)
              ? x.categoryId
              : categories[0].id
          const ts = typeof x.createdAt === 'number' ? x.createdAt : now()
          return {
            id: uniqueId(typeof x.id === 'string' ? x.id : title, itemSeen),
            categoryId,
            kind,
            title,
            description: typeof x.description === 'string' ? x.description : '',
            content: typeof x.content === 'string' ? x.content : '',
            url: typeof x.url === 'string' ? x.url : '',
            path: typeof x.path === 'string' ? x.path : '',
            tags: Array.isArray(x.tags) ? x.tags.filter((t): t is string => typeof t === 'string') : [],
            createdAt: ts,
            updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : ts,
          } satisfies KnowledgeItem
        })
    : []
  return {
    version: 1,
    categories: categories.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    items: items.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title)),
  }
}

export function readKnowledge(scope: KnowledgeScope, repoRoot: string): KnowledgeBase {
  const p = pathFor(scope, repoRoot)
  if (!p || !existsSync(p)) return defaultBase()
  try {
    return migrateKnowledge(JSON.parse(readFileSync(p, 'utf8')))
  } catch {
    return defaultBase()
  }
}

export function writeKnowledge(scope: KnowledgeScope, repoRoot: string, kb: KnowledgeBase): boolean {
  const p = pathFor(scope, repoRoot)
  if (!p) return false
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(migrateKnowledge(kb), null, 2))
    return true
  } catch {
    return false
  }
}
