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

export type KnowledgeRagStatus = {
  ok: boolean
  rootDir: string
  documentsDir: string
  dataDir: string
  command: string
  args: string[]
  stats?: unknown
  error?: string
}

export type KnowledgeRagSearchResult = {
  ok: boolean
  query: string
  rootDir: string
  results: unknown[]
  raw?: unknown
  error?: string
}
