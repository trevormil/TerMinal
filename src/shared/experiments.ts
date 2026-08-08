// Experimental feature flags — the one registry both processes read.
//
// Pure and dependency-free (no electron/node) so the main process can gate an
// IPC handler and the renderer can gate a tab off the SAME list. A flagged
// feature ships wired but dark: the code is on `main` and reachable, it just
// doesn't exist in the UI until the operator opts in.
//
// Adding a flag is a one-line diff here plus one in EXPERIMENT_META. The ids are
// an explicit closed set on purpose — an open Record<string, boolean> would let a
// typo'd flag read as "off" forever with nothing to catch it.

export const EXPERIMENT_IDS = ['loops', 'lanes'] as const
export type ExperimentId = (typeof EXPERIMENT_IDS)[number]

export type ExperimentMeta = {
  label: string
  /** One line: what the feature is. */
  desc: string
  /** What appears in the app once it is on — the honest "so what". */
  reveals: string
}

export const EXPERIMENT_META: Record<ExperimentId, ExperimentMeta> = {
  loops: {
    label: 'Convergence loops',
    desc: 'Run a prompt repeatedly until it converges; managed loop sessions.',
    reveals:
      'Adds a Paired loop mode to the New workspace screen (paired or single topology). ' +
      'Loop sessions then carry a status strip — phase, iteration, taste score, contract ' +
      'assertions — with a Stop loop control.',
  },
  lanes: {
    label: 'Ticket lanes',
    desc: 'Fan a ticket out to N competing implementation attempts; human picks the winner.',
    reveals: 'Adds a lane fan-out action on tickets and a comparison view for picking a winner.',
  },
}

/**
 * Persisted flag state. Absent means off — a settings file written before a flag
 * existed must never read as "on", so `undefined` and `false` are the same thing
 * and only an explicit `true` enables anything.
 */
export type ExperimentsCfg = Partial<Record<ExperimentId, boolean>>

/**
 * Is this experiment on? Takes anything settings-shaped so main (`Settings` from
 * src/main/settings) and the renderer (`Settings` from lib/types) share one
 * implementation instead of drifting copies.
 */
export function experimentEnabled(
  settings: { experiments?: ExperimentsCfg } | null | undefined,
  id: ExperimentId,
): boolean {
  return settings?.experiments?.[id] === true
}

/**
 * The server-side refusal for a flagged IPC handler: `null` to proceed, or an
 * `{ error }` result to return as-is. Hiding UI is not a gate — the preload
 * bridge stays reachable — so every handler behind a flag starts with this.
 *
 * The message names Settings → Experimental on purpose: a refusal the operator
 * cannot act on is a dead end.
 */
export function experimentGate(
  settings: { experiments?: ExperimentsCfg } | null | undefined,
  id: ExperimentId,
): { error: string } | null {
  if (experimentEnabled(settings, id)) return null
  return {
    error: `${EXPERIMENT_META[id].label} is experimental — turn it on in Settings → Experimental.`,
  }
}

/** Coerce a raw on-disk/patched value into shape: known ids, booleans only. */
export function normalizeExperiments(raw: unknown): ExperimentsCfg {
  const out: ExperimentsCfg = {}
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  for (const id of EXPERIMENT_IDS) {
    if (typeof r[id] === 'boolean') out[id] = r[id] as boolean
  }
  return out
}
