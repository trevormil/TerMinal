import type { Engine, SessionEngine } from './types'
import {
  ENGINE_IDS,
  ENGINES,
  engineAllowsCustomModelOf,
  engineLabelOf,
  type ModelOption,
} from '../../../shared/engines'

// Renderer-facing view of the shared engine registry (src/shared/engines.ts).
// These used to be four hand-maintained maps (label, session-label, models,
// vendor) that drifted from main's own copies; they are derived now, so a newly
// registered engine shows up in every picker automatically.

export type { ModelOption }
export { ENGINE_IDS }

export const ENGINE_LABEL: Record<Engine, string> = Object.fromEntries(
  ENGINE_IDS.map((id) => [id, ENGINES[id].label]),
) as Record<Engine, string>

export const SESSION_ENGINE_LABEL: Record<SessionEngine, string> = {
  ...ENGINE_LABEL,
  local: 'Local',
}

export function engineLabel(engine: Engine | string): string {
  return engineLabelOf(engine)
}

/** The per-engine model menu shown wherever a run is configured. An engine with
 *  an empty menu takes a free-text slug (see engineAllowsCustomModel). */
export const ENGINE_MODELS: Record<Engine, ModelOption[]> = Object.fromEntries(
  ENGINE_IDS.map((id) => [id, [...ENGINES[id].models]]),
) as Record<Engine, ModelOption[]>

export const ENGINE_VENDOR: Record<Engine, string> = Object.fromEntries(
  ENGINE_IDS.map((id) => [id, ENGINES[id].vendor]),
) as Record<Engine, string>

/** Engines that take an arbitrary model slug — their step shows a free-text field. */
export const engineAllowsCustomModel = (engine: Engine): boolean =>
  engineAllowsCustomModelOf(engine)

export function sessionEngineLabel(engine: SessionEngine | string): string {
  return engineLabelOf(engine)
}

/** Validate an untyped engine value (nav payloads, IPC) into a SessionEngine,
 *  falling back to 'claude'. Derived from the registry so a newly added engine
 *  can never be silently coerced away by a stale literal list. */
export function coerceSessionEngine(value: unknown): SessionEngine {
  return typeof value === 'string' && value in SESSION_ENGINE_LABEL
    ? (value as SessionEngine)
    : 'claude'
}
