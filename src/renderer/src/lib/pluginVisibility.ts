// Widget visibility persistence: `enabled` (gt.enabled) is the user's saved
// on/off list and `known` (gt.known) is every plugin id ever seen. A plugin id
// absent from `known` is newly shipped (or a first run) — it gets its
// `defaultEnabled`, so new built-in widgets appear for existing users without
// overriding anything the user explicitly turned off.

export function reconcileFreshPlugins(
  plugins: { id: string; defaultEnabled: boolean }[],
  known: string[],
  enabled: string[],
): { known: string[]; enabled: string[] } | null {
  const fresh = plugins.filter((p) => !known.includes(p.id))
  if (fresh.length === 0) return null
  return {
    known: Array.from(new Set([...known, ...fresh.map((p) => p.id)])),
    enabled: Array.from(
      new Set([...enabled, ...fresh.filter((p) => p.defaultEnabled).map((p) => p.id)]),
    ),
  }
}
