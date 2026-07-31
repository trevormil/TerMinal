import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Engine } from './agents'
import type { ScheduleSpec } from './cron'
import { hiddenPresetIds } from './presets'
import { readSchedules, seedSchedule, toggleSchedule } from './schedules'

// Daily automation packs — a one-click bundle of scheduled agents.
//
// A "pack" is deliberately NOT a new runtime concept. It is a named list of
// (agent id, cadence, engine) triples plus a description, and enabling one is
// just `seedSchedule()` + `toggleSchedule()` per entry. Everything downstream —
// launchd registration, worktree isolation, budget gating, retry/backoff,
// failure→HITL — is the machinery that already runs every other schedule.
//
// The value is purely that the human doesn't have to know which four agents
// constitute "keep my repo healthy" or what a sensible cadence for each is.

export type PackScope = 'repo' | 'global'

/** How a global pack's agent is delivered to `~/.config/TerMinal`. */
export type PackAsset =
  /** `<id>.sh` + `<id>.json` + `<id>.md` into `scripts/`. */
  | { kind: 'global-script'; id: string }
  /** A whole seeded directory into `persistent-agents/<id>/`. */
  | { kind: 'persistent-agent'; id: string }

export type PackAgent = {
  /** Matches `.agents/<id>.sh` (repo packs) or a global script id. */
  agentId: string
  title: string
  spec: ScheduleSpec
  engine: Engine
  model?: string
  /** Snapshot the runner uses when no `.agents/<id>.sh` exists. */
  prompt: string
  /**
   * For global agents: what must exist on disk before the schedule can do
   * anything. A repo pack has no asset — its script is committed in the repo's
   * own `.agents/`.
   */
  asset?: PackAsset
}

export type Pack = {
  id: string
  title: string
  description: string
  scope: PackScope
  agents: PackAgent[]
}

export type PackState = 'off' | 'partial' | 'on'

export type PackStatus = Pack & {
  state: PackState
  /** How many of the pack's agents currently have an enabled schedule. */
  enabledCount: number
  /** Whether this pack's global assets are already on disk. Enabling installs
   *  them, so this is informational — it exists so an enabled pack whose files
   *  were later deleted reads as broken instead of looking fine. */
  assetsInstalled: boolean
}

const contract = (kind: string, extra = '') =>
  `You are the ${kind} agent. Read .agents/${kind}.md — your complete contract — and execute it in full, honoring its mode, early-exit fast path, sole-writer scope, and worktree isolation. ${extra}Never merge; never push main.`

// Cadences are STAGGERED on purpose. Four agents firing at 03:00 means four
// concurrent worktrees, four engine processes, and a spend spike; spreading
// them also means a failure in one doesn't sit in the same run window as the
// rest. The briefing runs last, after everything it summarizes.
export const PACKS: Pack[] = [
  {
    id: 'daily-quality',
    title: 'Daily quality',
    description:
      'Backfills test coverage and sweeps dependencies + lint. Opens PRs you review; never merges.',
    scope: 'repo',
    agents: [
      {
        agentId: 'coverage',
        title: 'Coverage backfill',
        spec: { kind: 'calendar', hour: 3, minute: 0 },
        engine: 'claude',
        model: 'haiku',
        prompt: contract(
          'coverage',
          'Tests only — never modify source under test in the same change. ',
        ),
      },
      {
        agentId: 'deps-quality',
        title: 'Deps + quality sweep',
        spec: { kind: 'calendar', hour: 3, minute: 30 },
        engine: 'claude',
        model: 'haiku',
        prompt: contract(
          'deps-quality',
          'Honor the 3-day-age rule and the bot-PR janitor section. Never merge a bot PR. ',
        ),
      },
    ],
  },
  {
    id: 'daily-ideas',
    title: 'Daily ideas',
    description:
      'Proposes at most 3 horizon:future tickets a day, deduped against everything already proposed or dismissed.',
    scope: 'repo',
    agents: [
      {
        agentId: 'ticket-ideas',
        title: 'Ticket ideas',
        spec: { kind: 'calendar', hour: 4, minute: 0 },
        engine: 'claude',
        model: 'haiku',
        prompt: contract(
          'ticket-ideas',
          'At most 3 per day, all horizon:future and priority:low. Append every filed idea to the proposedIdeas ledger — skipping that step means you re-propose it tomorrow. Zero ideas is a valid outcome. ',
        ),
      },
    ],
  },
  {
    id: 'daily-briefing',
    title: 'Morning briefing',
    description:
      'Rolls up everything the overnight agents did into one reviewable list in the Inbox drawer. Cross-repo.',
    scope: 'global',
    agents: [
      {
        agentId: 'briefing',
        title: 'Morning briefing',
        asset: { kind: 'global-script', id: 'briefing' },
        // Last, so it can see the night's output. Everything above finishes by ~5.
        spec: { kind: 'calendar', hour: 7, minute: 0 },
        engine: 'claude',
        model: 'sonnet',
        prompt:
          'You are the briefing agent. Read briefing.md — your complete contract — and execute it in full: gather the last 24h across every repo, write ~/.config/TerMinal/briefings/<date>.md in the documented schema, and file EXACTLY ONE --severity=low HITL. Emit ledgerKey on every item an agent proposed. Never edit source, never open a PR, never merge.',
      },
    ],
  },
  {
    id: 'daily-learning',
    title: 'Research & teach',
    description:
      'Researches one thing worth knowing each day and teaches it, remembering what it has already covered.',
    scope: 'global',
    agents: [
      {
        agentId: 'research-teacher',
        title: 'Research & teacher',
        asset: { kind: 'persistent-agent', id: 'research-teacher' },
        spec: { kind: 'calendar', hour: 6, minute: 30 },
        // MUST be claude. Runs default to `codex exec`, which has no web
        // search, and a research agent without web search silently produces a
        // confident lesson from training data. This is not a preference.
        engine: 'claude',
        model: 'sonnet',
        prompt:
          'You are the research-teacher persistent agent. Read INSTRUCTIONS.md, MEMORY.md, STATE.md and recent JOURNAL.md entries first. Never teach a topic already in MEMORY.md. If you cannot actually fetch a URL, file a HITL and STOP — never teach from memory. Append the topic to MEMORY.md and the run to JOURNAL.md before ending.',
      },
    ],
  },
]

function packById(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id)
}

// ---------------------------------------------------------------------------
// Asset installation
//
// A repo pack's script is committed in the repo's own `.agents/`, so enabling
// it needs nothing. A GLOBAL pack's agent lives in ~/.config/TerMinal, which
// ships nothing by default — so without this step, enabling "Morning briefing"
// produced a schedule whose agentId resolved to no script at all. The runner
// then fell back to the schedule's inline prompt snapshot, which tells the
// engine to read a contract file that isn't on disk: no date gate, no
// deterministic gather, no failure HITL, and output the parser reads as zero
// items. Same for research-teacher, whose whole point is a MEMORY.md that
// would never have existed.
// ---------------------------------------------------------------------------

const moduleDir = dirname(fileURLToPath(import.meta.url))

function configDir(): string {
  return process.env.TERMINAL_CONFIG_DIR || join(homedir(), '.config', 'TerMinal')
}

/**
 * Where the bundled templates live. Packaged, electron-builder copies them to
 * `Contents/Resources/templates` via explicit `extraResources` entries; in dev
 * they sit two levels up from `out/main`. `process.resourcesPath` is undefined
 * outside Electron, which is also what makes this testable.
 */
function templatesDir(): string {
  if (process.env.TERMINAL_TEMPLATES_DIR) return process.env.TERMINAL_TEMPLATES_DIR
  const packaged = process.resourcesPath ? join(process.resourcesPath, 'templates') : ''
  if (packaged && existsSync(packaged)) return packaged
  return join(moduleDir, '..', '..', 'templates')
}

/**
 * Install one agent's assets, CREATE-IF-ABSENT.
 *
 * Never overwriting is the important half. `MEMORY.md` and `JOURNAL.md`
 * accumulate real history within days, and a global script may have been
 * hand-edited — silently resetting either on a re-enable would destroy work for
 * what looks like an idempotent toggle. Same instinct as `seedSchedule`.
 */
function installAsset(asset: PackAsset): { ok: true } | { ok: false; error: string } {
  const templates = templatesDir()

  if (asset.kind === 'global-script') {
    const from = join(templates, 'global-scripts')
    if (!existsSync(from)) return { ok: false, error: `pack assets not found at ${from}` }
    const to = join(configDir(), 'scripts')
    mkdirSync(to, { recursive: true })
    // The .md is the contract the prompt tells the engine to read, so it is
    // not optional dressing — ship it alongside the script and its sidecar.
    for (const ext of ['sh', 'json', 'md']) {
      const src = join(from, `${asset.id}.${ext}`)
      const dest = join(to, `${asset.id}.${ext}`)
      if (!existsSync(src) || existsSync(dest)) continue
      copyFileSync(src, dest)
      // TerMinal checks existence only and then execs the path directly, so a
      // non-executable script fails at run time with "permission denied".
      if (ext === 'sh') chmodSync(dest, 0o755)
    }
    if (!existsSync(join(to, `${asset.id}.sh`)))
      return { ok: false, error: `could not install ${asset.id}.sh` }
    return { ok: true }
  }

  const from = join(templates, 'persistent-agents', asset.id)
  if (!existsSync(from)) return { ok: false, error: `pack assets not found at ${from}` }
  const to = join(configDir(), 'persistent-agents', asset.id)
  if (existsSync(to)) return { ok: true } // never clobber accumulated memory
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to, { recursive: true })
  return { ok: true }
}

/** True when every asset this pack needs is already on disk. */
export function packAssetsInstalled(pack: Pack): boolean {
  return pack.agents.every((a) => {
    if (!a.asset) return true
    if (a.asset.kind === 'global-script')
      return existsSync(join(configDir(), 'scripts', `${a.asset.id}.sh`))
    const dir = join(configDir(), 'persistent-agents', a.asset.id)
    try {
      return existsSync(dir) && readdirSync(dir).length > 0
    } catch {
      return false
    }
  })
}

/**
 * Which existing schedule (if any) already represents this pack agent.
 *
 * The pack's scope decides the key, and that is the whole reason this helper
 * exists rather than leaning on `seedSchedule`'s own (repoRoot, agentId) check:
 *
 * - **`repo` packs key on (repoRoot, agentId).** Coverage genuinely needs to
 *   run once per repo, so two repos means two schedules.
 * - **`global` packs key on agentId ALONE.** The briefing summarizes every repo
 *   and the teacher isn't about a repo at all, so exactly one must ever exist.
 *   Keying them by repo meant enabling from a second repo silently produced a
 *   second schedule — two briefings, two HITLs, a duplicated morning.
 *
 * The store is keyed by repoRoot either way, so a global schedule still records
 * the repo it was first enabled from as its home. That home is deliberately NOT
 * re-pointed by a later enable: the schedule is already running from somewhere,
 * and quietly moving where it executes is a worse surprise than a stale label.
 */
function existingScheduleFor(pack: Pack, repoRoot: string, agentId: string) {
  return readSchedules().find(
    (s) => s.agentId === agentId && (pack.scope === 'global' || s.repoRoot === repoRoot),
  )
}

/**
 * Enable every agent in a pack. Adopting an existing schedule (rather than
 * adding one) preserves its id, run history, and any cadence the user retimed
 * by hand — only `enabled` flips. That is why enable is find-or-seed then
 * toggle, never remove-then-add.
 */
export function enablePack(
  repoRoot: string,
  repoLabel: string,
  packId: string,
): { ok: true; enabled: number } | { ok: false; error: string } {
  const pack = packById(packId)
  if (!pack) return { ok: false, error: `unknown pack: ${packId}` }

  // Install assets BEFORE seeding any schedule. A schedule pointing at a script
  // that isn't there is worse than no schedule: it fires nightly and silently
  // does the wrong thing via the prompt fallback.
  for (const agent of pack.agents) {
    if (!agent.asset) continue
    const r = installAsset(agent.asset)
    if (!r.ok) return r
  }

  let enabled = 0
  for (const agent of pack.agents) {
    const existing = existingScheduleFor(pack, repoRoot, agent.agentId)
    const sched =
      existing ??
      seedSchedule({
        repoRoot,
        repoLabel,
        agentId: agent.agentId,
        agentTitle: agent.title,
        engine: agent.engine,
        model: agent.model,
        prompt: agent.prompt,
        spec: agent.spec,
        enabled: false,
      })
    if (toggleSchedule(sched.id, true)) enabled++
  }
  return { ok: true, enabled }
}

/**
 * Turn a pack off WITHOUT deleting its schedules. Deleting would throw away run
 * history and any cadence the user tuned, and re-enabling would silently reset
 * them — an expensive surprise for a toggle that looks reversible.
 *
 * Global packs are matched repo-agnostically, so disabling the briefing works
 * from whichever repo you happen to be focused on — not only the one you first
 * enabled it from.
 */
export function disablePack(
  repoRoot: string,
  packId: string,
): { ok: true; disabled: number } | { ok: false; error: string } {
  const pack = packById(packId)
  if (!pack) return { ok: false, error: `unknown pack: ${packId}` }

  const ids = new Set(pack.agents.map((a) => a.agentId))
  let disabled = 0
  for (const s of readSchedules()) {
    if (!ids.has(s.agentId)) continue
    if (pack.scope !== 'global' && s.repoRoot !== repoRoot) continue
    if (toggleSchedule(s.id, false)) disabled++
  }
  return { ok: true, disabled }
}

/**
 * Every pack not dismissed by the user, with its state in this repo. A global
 * pack reports its true cross-repo state from ANY repo: claiming "off" for a
 * briefing that is genuinely running would invite the user to click Enable
 * again, which is exactly what used to duplicate it.
 */
export function packStatus(repoRoot: string): PackStatus[] {
  const hidden = hiddenPresetIds('packs')
  const all = readSchedules()

  return PACKS.filter((p) => !hidden.has(p.id)).map((pack) => {
    const enabledCount = pack.agents.filter((a) =>
      all.some(
        (s) =>
          s.agentId === a.agentId &&
          s.enabled &&
          (pack.scope === 'global' || s.repoRoot === repoRoot),
      ),
    ).length
    const state: PackState =
      enabledCount === 0 ? 'off' : enabledCount === pack.agents.length ? 'on' : 'partial'
    return { ...pack, state, enabledCount, assetsInstalled: packAssetsInstalled(pack) }
  })
}
