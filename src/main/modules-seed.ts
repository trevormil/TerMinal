// Capability-module seeding. Spawns project-template's seed-module.sh (the single
// copy engine, shared with the CLI), records seeded modules in .TerMinal/template.json,
// and seeds each module's automations as INERT schedules. Callers (index.ts IPCs /
// bootstrap modal) resolve `templateDir` via projectTemplateSource('modules/modules.json').
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { TERMINAL_DIR } from './project-layout'
import { seedSchedule } from './schedules'
import type { Engine } from './agents'
import type { ScheduleSpec } from './cron'
import { getModule, type CapabilityModule, type ModuleRegistry, type ProfileId, type SeededScheduleSpec } from './modules'

export type SeedResult = { ok: true } | { error: string }
export type SeedManyResult = { seeded: string[]; errors: Record<string, string> }

export function seedModule(repoRoot: string, id: string, templateDir: string): SeedResult {
  const script = join(templateDir, 'modules', 'seed-module.sh')
  if (!existsSync(script)) return { error: `seed engine missing at ${script}` }
  const r = spawnSync('bash', [script, repoRoot, id], { encoding: 'utf-8' })
  if (r.status !== 0) return { error: (r.stderr || r.stdout || 'seed failed').trim() }
  return { ok: true }
}

function toScheduleSpec(s: SeededScheduleSpec['spec']): ScheduleSpec {
  if (typeof s.everyMinutes === 'number') {
    return { kind: 'interval', everyMinutes: s.everyMinutes } as ScheduleSpec
  }
  return {
    kind: 'calendar',
    minute: s.minute ?? 0,
    hour: s.hour ?? 9,
    ...(s.weekdays ? { weekdays: s.weekdays } : {}),
  } as ScheduleSpec
}

function upsertTemplateModules(repoRoot: string, profile: ProfileId | undefined, ids: string[]) {
  const path = join(repoRoot, TERMINAL_DIR, 'template.json')
  let j: Record<string, unknown> = { schema: 'terminal.project-template', version: 2 }
  try {
    j = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    /* fresh file */
  }
  if (profile) j.profile = profile
  const mods = (j.modules as Record<string, { seeded: boolean; enabled: boolean }>) || {}
  for (const id of ids) mods[id] = { seeded: true, enabled: mods[id]?.enabled ?? false }
  j.modules = mods
  mkdirSync(join(repoRoot, TERMINAL_DIR), { recursive: true })
  writeFileSync(path, JSON.stringify(j, null, 2) + '\n')
}

function seedModuleSchedules(repoRoot: string, mod: CapabilityModule) {
  const repoLabel = basename(repoRoot)
  for (const sc of mod.automate.schedules ?? []) {
    seedSchedule({
      repoRoot,
      repoLabel,
      agentId: sc.agentId,
      agentTitle: sc.agentId,
      engine: (sc.engine ?? 'claude') as Engine,
      model: sc.model,
      prompt: '', // script-first agents run their .agents/<id>.sh; no prompt snapshot needed
      spec: toScheduleSpec(sc.spec),
      enabled: false,
    })
  }
}

/** Seed an explicit set of module ids (used by the bootstrap selection modal). */
export function seedModules(
  repoRoot: string,
  ids: string[],
  reg: ModuleRegistry,
  templateDir: string,
  profile?: ProfileId,
): SeedManyResult {
  const seeded: string[] = []
  const errors: Record<string, string> = {}
  for (const id of ids) {
    const mod = getModule(reg, id)
    if (!mod) {
      errors[id] = 'unknown module'
      continue
    }
    const r = seedModule(repoRoot, id, templateDir)
    if ('error' in r) {
      errors[id] = r.error
      continue
    }
    seedModuleSchedules(repoRoot, mod)
    seeded.push(id)
  }
  if (seeded.length || profile) upsertTemplateModules(repoRoot, profile, seeded)
  return { seeded, errors }
}

/** Seed every module in a profile, inert, and record the profile on the repo. */
export function applyProfile(
  repoRoot: string,
  profile: ProfileId,
  reg: ModuleRegistry,
  templateDir: string,
): SeedManyResult {
  return seedModules(repoRoot, reg.profiles[profile] ?? [], reg, templateDir, profile)
}
