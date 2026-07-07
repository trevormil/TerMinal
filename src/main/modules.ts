// Capability module registry loader. Types mirror
// project-template/modules/registry.d.ts. Registry DATA is read from the resolved
// template at runtime (via projectTemplateSource in index.ts) — TerMinal ships no
// catalog, so there is nothing to keep in sync. See modules-detect.ts / modules-seed.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type ModuleId = 'health' | 'feedback' | 'api-docs' | 'deploy' | 'observability' | 'testing'
export type ProfileId = 'web-service' | 'library' | 'cli' | 'worker'
export type ModuleScope = 'repo' | 'platform'

export type DataSource =
  | { kind: 'file'; path: string }
  | { kind: 'cli'; cmd: string }
  | { kind: 'http'; url: string }
  | { kind: 'db'; conn: string; query: string }

export type WidgetSpec = {
  kind: 'status' | 'table' | 'chart' | 'sparkline' | 'logtail' | 'stat'
  source: number
  title: string
  map?: Record<string, string>
}
export type ModuleLink = { label: string; url: string }
export type ModuleAction = {
  id: string
  label: string
  kind: 'seed' | 'apply-profile' | 'toggle-schedule' | 'run-check' | 'cli'
  cmd?: string
  agentId?: string
}
export type SeededScheduleSpec = {
  agentId: string
  spec: { everyMinutes?: number; minute?: number; hour?: number; weekdays?: number[] }
  engine?: 'claude' | 'codex'
  model?: string
}
export type CapabilityModule = {
  id: ModuleId
  title: string
  summary: string
  scope: ModuleScope
  seed: { root: 'seed'; preserve?: string[]; gitignore?: string[] }
  detect: { markers: string[]; requireAll?: string[] }
  surface: {
    adminLabel: string
    group: string
    docPath?: string
    data?: DataSource[]
    widgets?: WidgetSpec[]
    links?: ModuleLink[]
    actions?: ModuleAction[]
  }
  automate: { agents?: string[]; schedules?: SeededScheduleSpec[]; filesTickets?: boolean }
}
export type ModuleRegistry = {
  version: 1
  modules: CapabilityModule[]
  profiles: Record<ProfileId, ModuleId[]>
}

/** Read the registry catalog from a resolved template dir (contains modules/modules.json). */
export function loadRegistry(templateDir: string): ModuleRegistry {
  const raw = readFileSync(join(templateDir, 'modules', 'modules.json'), 'utf-8')
  return JSON.parse(raw) as ModuleRegistry
}

export function getModule(reg: ModuleRegistry, id: string): CapabilityModule | undefined {
  return reg.modules.find((m) => m.id === id)
}
