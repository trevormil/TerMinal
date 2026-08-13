import type { AgentModelPolicy, AgentQuality, Engine } from './agents'

export type PersistentAgent = {
  id: string
  title: string
  description?: string
  engine: Engine
  model?: string
  modelPolicy?: AgentModelPolicy
  quality?: AgentQuality
  tags: string[]
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  dir: string
}

export type PersistentAgentFiles = {
  instructions: string
  memory: string
  state: string
  journal: string
}

export type PersistentAgentDetail = PersistentAgent & {
  files: PersistentAgentFiles
}

export type PersistentArtifactFile = {
  name: string
  path: string
  size: number
  mtime: number
  kind: 'markdown' | 'json' | 'image' | 'html' | 'text' | 'other'
}

export type PersistentArtifact = {
  id: string
  title: string
  kind: string
  path: string
  createdAt: number
  summary?: string
  runId?: string
  primaryPath?: string
  files: PersistentArtifactFile[]
}

export type PersistentArtifactRead =
  | {
      ok: true
      kind: PersistentArtifactFile['kind']
      content: string
      dataUrl?: string
      path: string
    }
  | { ok: false; reason: string; path?: string }
