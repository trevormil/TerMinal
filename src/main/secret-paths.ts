// Where the secrets live inside a settings object — the single list that both
// sealing (settings.ts, encrypt-on-disk) and masking (settings-mask.ts,
// never-ship-to-the-renderer) walk. They used to keep separate copies, which
// only worked while every secret sat at a fixed path.
//
// Webhooks are a LIST now, so a fixed path can't name them. `*` matches every
// index of an array, and expansion happens against the actual object, so the
// two consumers can't disagree about which paths exist.

/** `*` matches every index of an array at that position. */
export const SECRET_PATTERNS: readonly (readonly string[])[] = [
  ['telegram', 'botToken'],
  ['telegram', 'chatId'],
  ['slack', 'botToken'],
  ['alerts', 'webhooks', '*', 'url'], // Slack/Discord webhook URLs embed a secret token
  ['openrouterApiKey'],
  ['openaiCompatApiKey'],
] as const

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

/**
 * Every concrete path a pattern matches in `root`, wildcards resolved against
 * the real arrays.
 *
 * A wildcard-free pattern is returned whether or not anything is there: it's a
 * statically-known secret, and masking reports "not set" for it rather than
 * dropping it from the map. Only `*` needs real data — an index that doesn't
 * exist isn't a secret anyone can have set.
 */
export function expandSecretPaths(
  root: unknown,
  patterns: readonly (readonly string[])[] = SECRET_PATTERNS,
): string[][] {
  const out: string[][] = []
  for (const pattern of patterns) walk(root, pattern, [], out)
  return out
}

function walk(node: unknown, rest: readonly string[], prefix: string[], out: string[][]): void {
  if (rest.length === 1) {
    out.push([...prefix, rest[0]])
    return
  }
  const [head, ...tail] = rest
  if (head === '*') {
    if (!Array.isArray(node)) return
    node.forEach((child, i) => walk(child, tail, [...prefix, String(i)], out))
    return
  }
  walk(isObj(node) ? node[head] : undefined, tail, [...prefix, head], out)
}
