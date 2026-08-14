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
