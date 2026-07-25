// THE engine registry — one descriptor per coding agent, and the single source
// of truth for every other engine-aware site in the app.
//
// Before this existed, adding one engine meant editing ~38 files: eleven
// duplicate id unions (four of them stale in preload alone), four label maps,
// three hand-written settings blocks, and five headless command builders — one
// of which carried a "keep in sync by hand" comment. Everything derivable now
// derives from here, so a new engine is (mostly) one entry in this file.
//
// Pure and dependency-free (no node/electron imports) so main, preload, and the
// renderer can all import it — same rule as shared/notifications.ts. Anything
// needing the filesystem (binary probing, `~` expansion) consumes the DECLARED
// shape here and resolves it in main.

export type ModelOption = { id: string; label: string }

/** How an engine takes a model: `--model x`, `-m x`, or not at all. */
export type ModelFlag = '--model' | '-m' | null

/** How an engine takes its FIRST prompt at launch while staying interactive.
 *  Verified per-CLI from each tool's own --help (see engine-seed). */
export type SeedStyle =
  | 'positional' // claude/codex/cursor: `<bin> [flags] "<prompt>"`
  | 'flag:-z' // hermes
  | 'flag:--prompt' // opencode
  | 'none' // cannot be seeded (a bare shell)

/** How an engine resumes an existing session. */
export type ResumeStyle =
  | 'flag:--resume' // cursor, hermes, claude
  | 'sub:resume' // codex: `codex resume <id>`
  | 'flag:-s' // opencode: `-s <id>`
  | 'none'

export type EngineDescriptor = {
  id: string
  /** Display name. NEVER render a bare lowercase id. */
  label: string
  /** One-line vendor/description for pickers. */
  vendor: string
  /** Binary resolution inputs — resolved against the filesystem in main
   *  (settings.enginePath). `candidates` may use `~`, expanded by the caller. */
  bin: { name: string; envVar?: string; candidates?: string[] }
  models: ModelOption[]
  /** Takes an arbitrary model slug → the UI shows a free-text field. */
  allowsCustomModel: boolean
  modelFlag: ModelFlag
  seed: SeedStyle
  resume: ResumeStyle
  /** Static flags every interactive launch gets. */
  baseArgs: readonly string[]
  caps: {
    /** Has a session store TerMinal can list/resume from. */
    resumable: boolean
    /** Can be dispatched to a remote SSH host. */
    remote: boolean
    /** Rides the or-agent harness (OpenRouter / self-hosted endpoints). */
    orAgentHarness: boolean
  }
}

// NOTE: `local` is deliberately NOT here — it is a bare login shell, not a
// coding agent. SessionEngine = EngineId | 'local' keeps that distinction.
export const ENGINES = {
  claude: {
    id: 'claude',
    label: 'Claude',
    vendor: 'Anthropic Claude',
    bin: { name: 'claude', envVar: 'GT_CLAUDE_BIN' },
    models: [
      { id: 'haiku', label: 'haiku' },
      { id: 'sonnet', label: 'sonnet' },
      { id: 'opus', label: 'opus' },
      { id: 'fable', label: 'fable' },
    ],
    allowsCustomModel: false,
    modelFlag: '--model',
    seed: 'positional',
    resume: 'flag:--resume',
    baseArgs: ['--permission-mode', 'auto'],
    caps: { resumable: true, remote: true, orAgentHarness: false },
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    vendor: 'OpenAI Codex',
    bin: { name: 'codex' },
    models: [
      { id: 'gpt-5-codex', label: 'gpt-5-codex' },
      { id: 'gpt-5', label: 'gpt-5' },
    ],
    allowsCustomModel: false,
    modelFlag: '--model',
    seed: 'positional',
    resume: 'sub:resume',
    baseArgs: ['-s', 'danger-full-access', '-a', 'never'],
    caps: { resumable: true, remote: true, orAgentHarness: false },
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    vendor: 'Cursor Agent',
    bin: { name: 'cursor-agent', envVar: 'GT_CURSOR_BIN' },
    models: [
      { id: 'sonnet-4', label: 'sonnet-4' },
      { id: 'gpt-5', label: 'gpt-5' },
    ],
    allowsCustomModel: false,
    modelFlag: '--model',
    seed: 'positional',
    resume: 'flag:--resume',
    baseArgs: [],
    caps: { resumable: true, remote: true, orAgentHarness: false },
  },
  opencode: {
    id: 'opencode',
    label: 'opencode',
    vendor: 'opencode · any provider',
    // Installs to ~/.opencode/bin and is often NOT on a login shell's PATH.
    bin: { name: 'opencode', candidates: ['~/.opencode/bin/opencode'] },
    models: [],
    // `-m provider/model` takes any slug from `opencode models`.
    allowsCustomModel: true,
    modelFlag: '-m',
    seed: 'flag:--prompt',
    resume: 'flag:-s',
    baseArgs: [],
    caps: { resumable: true, remote: true, orAgentHarness: false },
  },
  hermes: {
    id: 'hermes',
    label: 'Hermes',
    vendor: 'Nous Hermes',
    bin: { name: 'hermes' },
    models: [],
    allowsCustomModel: true,
    modelFlag: '-m',
    seed: 'flag:-z',
    resume: 'flag:--resume',
    baseArgs: ['--tui'],
    caps: { resumable: true, remote: false, orAgentHarness: false },
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    vendor: 'OpenRouter · Codex or Hermes harness',
    bin: {
      name: 'or-agent',
      candidates: ['~/.config/TerMinal/bin/or-agent', '~/.claude/bin/or-agent'],
    },
    models: [],
    allowsCustomModel: true,
    modelFlag: '-m',
    // Interactive OpenRouter runs through a harness (codex or hermes); the
    // seed/resume shape follows the chosen harness, resolved at launch.
    seed: 'positional',
    resume: 'none',
    baseArgs: [],
    caps: { resumable: false, remote: false, orAgentHarness: true },
  },
  'openai-compat': {
    id: 'openai-compat',
    label: 'Self-hosted',
    vendor: 'Self-hosted · OpenAI-compatible endpoint · Codex harness',
    bin: {
      name: 'or-agent',
      candidates: ['~/.config/TerMinal/bin/or-agent', '~/.claude/bin/or-agent'],
    },
    models: [],
    allowsCustomModel: true,
    modelFlag: '-m',
    seed: 'positional',
    resume: 'none',
    baseArgs: [],
    caps: { resumable: false, remote: false, orAgentHarness: true },
  },
} as const satisfies Record<string, EngineDescriptor>

export type EngineId = keyof typeof ENGINES
/** Every engine id. Order is the canonical UI ordering. */
export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[]

/** A terminal session's engine — the agents above plus a bare login shell. */
export type SessionEngineId = EngineId | 'local'
export const SESSION_ENGINE_IDS: SessionEngineId[] = [...ENGINE_IDS, 'local']

export const isEngineId = (v: unknown): v is EngineId => typeof v === 'string' && v in ENGINES
export const isSessionEngineId = (v: unknown): v is SessionEngineId =>
  v === 'local' || isEngineId(v)

export const engineOf = (id: EngineId): EngineDescriptor => ENGINES[id]

/** Display label for any engine id (incl. 'local'); echoes the input if unknown
 *  so an unrecognised value never renders as blank. */
export function engineLabelOf(id: string): string {
  if (id === 'local') return 'Local'
  return isEngineId(id) ? ENGINES[id].label : id
}

export function engineVendorOf(id: string): string {
  return isEngineId(id) ? ENGINES[id].vendor : ''
}

export function engineModelsOf(id: string): readonly ModelOption[] {
  return isEngineId(id) ? ENGINES[id].models : []
}

export function engineAllowsCustomModelOf(id: string): boolean {
  return isEngineId(id) ? ENGINES[id].allowsCustomModel : false
}

/** Validate an untyped engine value (nav payloads, IPC, config) into a
 *  SessionEngineId, falling back to `fallback`. Derived from the registry, so a
 *  newly added engine can never be silently coerced away by a stale list. */
export function coerceSessionEngine(
  value: unknown,
  fallback: SessionEngineId = 'claude',
): SessionEngineId {
  return isSessionEngineId(value) ? value : fallback
}

// ---- launch-argument construction (shared by every invocation path) --------

/** The args that seed an engine's FIRST prompt while keeping it interactive.
 *  Empty when the engine can't be seeded or there's no prompt. */
export function seedArgs(id: string, prompt: string): string[] {
  if (!prompt || !isEngineId(id)) return []
  switch (ENGINES[id].seed) {
    case 'positional':
      return [prompt]
    case 'flag:-z':
      return ['-z', prompt]
    case 'flag:--prompt':
      return ['--prompt', prompt]
    default:
      return []
  }
}

/** Every registered engine is seedable today; `local` (not registered) is not.
 *  The SeedStyle union keeps 'none' available for a future engine that can't. */
export const engineSupportsSeed = (id: string): boolean =>
  isEngineId(id) && seedArgs(id, 'x').length > 0

/** The args that resume an existing session, or [] when unsupported. */
export function resumeArgs(id: string, sessionId: string): string[] {
  if (!sessionId || !isEngineId(id)) return []
  switch (ENGINES[id].resume) {
    case 'flag:--resume':
      return ['--resume', sessionId]
    case 'sub:resume':
      return ['resume', sessionId]
    case 'flag:-s':
      return ['-s', sessionId]
    default:
      return []
  }
}

/** The args that select a model, or [] when the engine takes none. */
export function modelArgs(id: string, model: string): string[] {
  if (!model || !isEngineId(id)) return []
  const flag = ENGINES[id].modelFlag
  return flag ? [flag, model] : []
}
