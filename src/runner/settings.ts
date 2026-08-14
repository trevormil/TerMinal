// Everything the runner reads out of settings.json (and the sidecars the app
// mirrors for it). This process cannot decrypt anything Electron's safeStorage
// sealed, so a sealed value is treated as absent rather than as a token.
import type { Schedule } from '../shared/types/schedules'
import { readJson, SETTINGS_FILE, TG_SIDECAR } from './config'

type EngineSettings = { defaultModel?: string; defaultEffort?: string; baseUrl?: string }
type Settings = {
  engines?: Record<string, EngineSettings>
  telegram?: { botToken?: unknown; chatId?: unknown }
  inbox?: { notifyThreshold?: string }
  harnessDir?: string
}

function settings(): Settings | null {
  return readJson<Settings>(SETTINGS_FILE())
}

export type TelegramCreds = { botToken: string; chatId: string }

// Resolve usable Telegram creds: the app seals its token in settings.json via
// Electron safeStorage, which this launchd-spawned Bun process can't decrypt —
// so the app mirrors decrypted creds to a 0600 sidecar we read here. A sealed
// {__terminalSecret} object is skipped (not a usable string token). Canonical
// impl + tests: src/main/settings.ts:resolveTelegramCreds — keep in sync.
export function tgCreds(): TelegramCreds | null {
  const pick = (o: { botToken?: unknown; chatId?: unknown } | null): TelegramCreds | null => {
    const bt = o?.botToken
    const ci = o?.chatId
    return typeof bt === 'string' && bt && typeof ci === 'string' && ci
      ? { botToken: bt, chatId: ci }
      : null
  }
  const sc = readJson<{ botToken?: unknown; chatId?: unknown }>(TG_SIDECAR())
  const st = settings()?.telegram ?? null
  return pick(sc) ?? pick(st)
}

// Resolve the per-engine default model from settings — same fallback the
// in-process runner (src/main/agents.ts) applies, so cron runs respect the
// user's "always use sonnet" preference when the schedule itself has no
// explicit override.
export function engineDefaultModel(engine: string): string {
  return (settings()?.engines?.[engine]?.defaultModel || '').trim()
}

// Per-engine reasoning-effort support — mirrors src/shared/engines.ts (keep in
// sync by hand, like OR_PREAMBLE). Level set validated here so a stale/foreign
// value in schedules.json or settings.json is dropped, never passed to a CLI
// that would reject it.
export const ENGINE_EFFORTS: Record<string, string[]> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  pi: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  opencode: ['minimal', 'low', 'medium', 'high', 'max'],
  openrouter: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'openai-compat': ['minimal', 'low', 'medium', 'high', 'xhigh'],
}

export function engineDefaultEffort(engine: string): string {
  return (settings()?.engines?.[engine]?.defaultEffort || '').trim()
}

/** The resolved, validated effort level for a schedule ('' = none). */
export function resolveEffort(sched: Pick<Schedule, 'effort' | 'engine'>): string {
  const level = (sched.effort || '').trim() || engineDefaultEffort(sched.engine)
  return (ENGINE_EFFORTS[sched.engine] || []).includes(level) ? level : ''
}

/** The engine-native effort args as a shell fragment ('' when none apply). */
export function effortFlag(sched: Pick<Schedule, 'effort' | 'engine'>): string {
  const level = resolveEffort(sched)
  if (!level) return ''
  if (sched.engine === 'claude') return ` --effort ${level}`
  if (sched.engine === 'pi') return ` --thinking ${level}`
  if (sched.engine === 'opencode') return ` --variant ${level}`
  if (sched.engine === 'openrouter' || sched.engine === 'openai-compat')
    return ` --effort ${level}` // or-agent passthrough → codex model_reasoning_effort
  return ` -c model_reasoning_effort=${level}` // codex (TUI and exec take -c)
}

// The openai-compat base URL is a PLAIN settings value (unlike the sealed API
// key, which this out-of-process runner cannot decrypt — the key comes from
// the login shell's OPENAI_API_KEY or a per-schedule env override, else the
// 'none' placeholder that keyless local servers accept).
export function openAICompatBaseUrl(): string {
  return (settings()?.engines?.['openai-compat']?.baseUrl || '').trim()
}

export function inboxNotifyThreshold(): string | undefined {
  return settings()?.inbox?.notifyThreshold
}

// env override → settings → disabled. Open-source installs do not have a
// canonical cross-repo harness checkout, so leave this off until configured.
export function harnessDir(): string {
  if (process.env.GT_HARNESS_DIR) return process.env.GT_HARNESS_DIR
  return settings()?.harnessDir || ''
}
