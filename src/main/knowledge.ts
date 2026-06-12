import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type KnowledgeScope = 'repo' | 'global'
export type KnowledgeItemKind = 'markdown' | 'link' | 'image' | 'video' | 'file' | 'rag'
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
  thumbnailUrl?: string
  faviconUrl?: string
  siteName?: string
  rag?: KnowledgeRagConfig
  tags: string[]
  createdAt: number
  updatedAt: number
}
export type KnowledgeRagConfig = {
  rootDir?: string
  command?: string
  args?: string[]
  category?: string
  hybridAlpha?: number
  maxResults?: number
}
export type KnowledgePreview = {
  ok: boolean
  url: string
  title?: string
  description?: string
  thumbnailUrl?: string
  faviconUrl?: string
  siteName?: string
  error?: string
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
            x.kind === 'link' || x.kind === 'image' || x.kind === 'video' || x.kind === 'file' || x.kind === 'markdown' || x.kind === 'rag'
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
            thumbnailUrl: typeof x.thumbnailUrl === 'string' ? x.thumbnailUrl : '',
            faviconUrl: typeof x.faviconUrl === 'string' ? x.faviconUrl : '',
            siteName: typeof x.siteName === 'string' ? x.siteName : '',
            rag: normalizeRagConfig(x.rag),
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

function normalizeRagConfig(raw: unknown): KnowledgeRagConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: KnowledgeRagConfig = {}
  if (typeof r.rootDir === 'string') out.rootDir = r.rootDir
  if (typeof r.command === 'string') out.command = r.command
  if (Array.isArray(r.args)) out.args = r.args.filter((x): x is string => typeof x === 'string')
  if (typeof r.category === 'string') out.category = r.category
  if (typeof r.hybridAlpha === 'number' && Number.isFinite(r.hybridAlpha)) out.hybridAlpha = r.hybridAlpha
  if (typeof r.maxResults === 'number' && Number.isFinite(r.maxResults)) out.maxResults = Math.max(1, Math.min(20, Math.round(r.maxResults)))
  return Object.keys(out).length ? out : undefined
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

function absUrl(base: URL, value: string): string {
  try {
    return new URL(value, base).toString()
  } catch {
    return ''
  }
}

function firstMeta(html: string, names: string[]): string {
  const tags = html.match(/<meta\s+[^>]*>/gi) || []
  for (const name of names) {
    const tag = tags.find((t) => attr(t, 'property') === name || attr(t, 'name') === name) || ''
    const content = attr(tag, 'content')
    if (content.trim()) return decodeHtml(content.trim())
  }
  return ''
}

function attr(tag: string, name: string): string {
  const raw = tag.match(new RegExp(`\\s${name}=["']([^"']+)["']`, 'i'))?.[1] || ''
  return decodeHtml(raw.trim())
}

function tagHasAnyAttrValue(tag: string, attrName: string, values: string[]): boolean {
  const value = attr(tag, attrName).toLowerCase()
  return values.some((v) => value.split(/\s+/).includes(v))
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function pageTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''
  return decodeHtml(raw.replace(/\s+/g, ' ').trim())
}

export function parseKnowledgePreviewHtml(rawUrl: string, html: string): KnowledgePreview {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, url: rawUrl, error: 'Invalid URL.' }
  }
  const title = firstMeta(html, ['og:title', 'twitter:title']) || pageTitle(html)
  const description = firstMeta(html, ['og:description', 'twitter:description', 'description'])
  const siteName = firstMeta(html, ['og:site_name', 'application-name']) || url.hostname.replace(/^www\./, '')
  const image = firstMeta(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'])
  const iconTag =
    (html.match(/<link\s+[^>]*>/gi) || []).find((tag) =>
      tagHasAnyAttrValue(tag, 'rel', ['icon', 'shortcut', 'apple-touch-icon']),
    ) || ''
  const icon = attr(iconTag, 'href')
  return {
    ok: true,
    url: url.toString(),
    title,
    description,
    siteName,
    thumbnailUrl: image ? absUrl(url, decodeHtml(image)) : '',
    faviconUrl: icon ? absUrl(url, decodeHtml(icon)) : `${url.origin}/favicon.ico`,
  }
}

export async function fetchKnowledgePreview(rawUrl: string): Promise<KnowledgePreview> {
  let url: URL
  try {
    url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, url: rawUrl, error: 'Only http(s) links can be enriched.' }
    }
  } catch {
    return { ok: false, url: rawUrl, error: 'Invalid URL.' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'TerMinal knowledge preview (+https://github.com/trevormil/TerMinal)',
      },
    })
    if (!res.ok) return { ok: false, url: url.toString(), error: `HTTP ${res.status}` }
    const html = (await res.text()).slice(0, 800_000)
    return parseKnowledgePreviewHtml(url.toString(), html)
  } catch (e) {
    return { ok: false, url: url.toString(), error: (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}
