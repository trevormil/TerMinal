export type SearchHit = { file: string; line: number; text: string }

export type WorkspaceSearchKind =
  'file' | 'ticket' | 'mr' | 'activity' | 'doc' | 'run' | 'snippet' | 'agent-artifact'

export type WorkspaceSearchResult = {
  id: string
  kind: WorkspaceSearchKind
  title: string
  subtitle?: string
  detail?: string
  path?: string
  line?: number
  ts?: number
  payload?: Record<string, unknown>
}

export type WorkspaceSearchResponse = {
  results: WorkspaceSearchResult[]
  error?: string
}
