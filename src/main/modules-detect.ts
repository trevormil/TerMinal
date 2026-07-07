// Per-repo capability-module detection. Authoritative signal is the repo's
// .TerMinal/template.json `modules{}` record (what our system seeded); filesystem
// `detect.markers` are the fallback so manually-scaffolded or legacy repos still read.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TERMINAL_DIR } from './project-layout'
import type { ModuleRegistry } from './modules'

export type ModuleState = 'present' | 'partial' | 'absent'
export type ModuleMarker = { path: string; present: boolean }
export type ModuleStatus = {
  id: string
  state: ModuleState
  seeded: boolean
  enabled: boolean
  markers: ModuleMarker[]
}

type TemplateModuleRecord = { seeded?: boolean; enabled?: boolean }

export function readTemplateModules(repoRoot: string): Record<string, TemplateModuleRecord> {
  try {
    const j = JSON.parse(readFileSync(join(repoRoot, TERMINAL_DIR, 'template.json'), 'utf-8'))
    return (j.modules as Record<string, TemplateModuleRecord>) || {}
  } catch {
    return {}
  }
}

export function moduleStatus(repoRoot: string, reg: ModuleRegistry): ModuleStatus[] {
  const tmpl = readTemplateModules(repoRoot)
  return reg.modules.map((m) => {
    const markers: ModuleMarker[] = m.detect.markers.map((rel) => ({
      path: rel,
      present: existsSync(join(repoRoot, rel)),
    }))
    const requireAll = m.detect.requireAll ?? m.detect.markers
    const allMarkers = requireAll.every((rel) => existsSync(join(repoRoot, rel)))
    const anyMarker = markers.some((x) => x.present)
    const rec = tmpl[m.id]
    const seeded = !!rec?.seeded
    let state: ModuleState
    if (seeded && allMarkers) state = 'present'
    else if (seeded || anyMarker) state = 'partial'
    else state = 'absent'
    return { id: m.id, state, seeded, enabled: !!rec?.enabled, markers }
  })
}
