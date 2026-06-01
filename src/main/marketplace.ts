import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type MarketplaceType = 'plugin' | 'widget' | 'skill' | 'agent' | 'snippet'
export type MarketplaceScope = 'app' | 'global' | 'repo'

export type MarketplaceItem = {
  id: string
  type: MarketplaceType
  title: string
  description: string
  version: number
  addedBy: string
  icon?: string
  accent?: string
  featured?: boolean
  engine?: ('claude' | 'codex' | 'cursor' | 'local')[]
  paths: string[]
  install: {
    copyTo: string
    merge?: string
    scope?: MarketplaceScope
  }
  tags: string[]
  homepage?: string
}

export type MarketplaceManifest = {
  version: number
  updated: string
  baseRawUrl: string
  items: MarketplaceItem[]
  sourcePath: string
}

function isItem(x: unknown): x is MarketplaceItem {
  const r = x as Record<string, unknown>
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.id === 'string' &&
    typeof r.type === 'string' &&
    typeof r.title === 'string' &&
    typeof r.description === 'string' &&
    typeof r.version === 'number' &&
    typeof r.addedBy === 'string' &&
    Array.isArray(r.paths) &&
    !!r.install &&
    typeof r.install === 'object' &&
    Array.isArray(r.tags)
  )
}

export function readMarketplace(candidates: string[]): MarketplaceManifest {
  for (const root of candidates) {
    if (!root) continue
    const manifestPath = join(root, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
      const items = Array.isArray(raw.items) ? raw.items.filter(isItem) : []
      return {
        version: typeof raw.version === 'number' ? raw.version : 1,
        updated: typeof raw.updated === 'string' ? raw.updated : '',
        baseRawUrl: typeof raw.baseRawUrl === 'string' ? raw.baseRawUrl : '',
        items,
        sourcePath: root,
      }
    } catch {
      /* try the next candidate */
    }
  }
  return { version: 1, updated: '', baseRawUrl: '', items: [], sourcePath: '' }
}
