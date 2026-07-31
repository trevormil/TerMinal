// ---------------------------------------------------------------------------
// `settings:get` used to hand the renderer every secret in cleartext — Telegram
// bot token, OpenRouter / OpenAI keys, the alert webhook URL — decrypted, on
// every settings read. They are sealed on disk precisely so they aren't lying
// around in the clear; shipping them to the renderer undoes that, and puts them
// one XSS (or one rendered PR body) away from exfiltration.
//
// The renderer never needs the VALUE. It needs to know whether one is set (to
// render "configured" vs "not configured") and to write a new one. So this
// replaces every secret with a fixed mask and adds a `secretsSet` map.
//
// The mask is deliberately non-empty so existing truthiness checks in the
// Settings UI keep reading "configured", and the UI's own
// `value !== current && save(...)` guard means blurring an untouched field
// writes nothing — only a real edit saves, and a real edit is never the mask.
// ---------------------------------------------------------------------------

/** What the renderer sees instead of a secret. Never a valid credential. */
export const SECRET_MASK = '••••••••'

/** Dotted paths of every value `settings.ts` seals on disk (SECRET_PATHS). */
export const MASKED_PATHS = [
  'telegram.botToken',
  'telegram.chatId',
  'alerts.webhook.url',
  'openrouterApiKey',
  'openaiCompatApiKey',
] as const

export type MaskedSettings<T> = T & { secretsSet: Record<string, boolean> }

function readPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

/** Deep-ish clone along the masked paths only — the rest is shared by reference,
 *  which is fine because the result is immediately serialised over IPC. */
function writePath(obj: Record<string, unknown>, path: string, value: string): void {
  const keys = path.split('.')
  let node: Record<string, unknown> = obj
  for (const key of keys.slice(0, -1)) {
    const next = node[key]
    if (!next || typeof next !== 'object') return
    node[key] = { ...(next as Record<string, unknown>) }
    node = node[key] as Record<string, unknown>
  }
  node[keys[keys.length - 1]] = value
}

/**
 * Replace every sealed secret with `SECRET_MASK` and report which ones are set.
 * An unset secret stays `''` so "not configured" is still distinguishable from
 * "configured but hidden".
 */
export function maskSettingsSecrets<T extends object>(settings: T): MaskedSettings<T> {
  const out = { ...(settings as Record<string, unknown>) }
  const secretsSet: Record<string, boolean> = {}
  for (const path of MASKED_PATHS) {
    const value = readPath(settings, path)
    const set = typeof value === 'string' && value !== ''
    secretsSet[path] = set
    if (set) writePath(out, path, SECRET_MASK)
  }
  return { ...out, secretsSet } as MaskedSettings<T>
}

/**
 * Drop any masked-secret value from an inbound patch. Without this, a renderer
 * that round-trips the settings object it was given would overwrite a real
 * credential with '••••••••'. Only the masked leaves are removed; everything
 * else in the patch (including a genuine new secret) passes through untouched.
 */
export function stripMaskedSecrets<T extends object>(patch: T): T {
  let out: Record<string, unknown> | null = null
  for (const path of MASKED_PATHS) {
    if (readPath(patch, path) !== SECRET_MASK) continue
    out = out || structuredClone(patch as Record<string, unknown>)
    const keys = path.split('.')
    let node: Record<string, unknown> = out
    for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>
    delete node[keys[keys.length - 1]]
  }
  return (out ?? patch) as T
}
