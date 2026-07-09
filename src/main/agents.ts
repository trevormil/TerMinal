import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import {
  readFileSync,
  existsSync,
  appendFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { emitActivity } from './events'
import { repoForCwd } from './repo'
import { forgeFor } from './forge'
import { getPersona, type Persona } from './personas'
import { enginePath, engineDefaultModel, readSettings, resolvedWorktreesDir, resolvedOpenRouterKey } from './settings'
import { readGlobalAgents, saveGlobalAgent } from './agents-global'
import { fileHitl } from './hitl'
import { composeSteps, pipelineLabel, type Step } from './pipelines'
import { hiddenPresetIds } from './presets'
import {
  getPersistentAgent,
  listPersistentAgents,
  persistentAgentDesignerPrompt,
  persistentAgentLaunchPrompt,
} from './persistent-agents'
import { createAgentStreamDecoder } from './agent-stream'
import { evaluateAgentRun } from './agent-run-evaluation'
import { withAgentContextPreamble } from './context-preamble'
import { getRepoTicket, repoTicketProvider, ticketProviderInstructions } from './ticket-provider'
import { getTicket as getLocalTicket, updateTicket as updateLocalTicket } from './backlog'
import type { TicketAgent } from './backlog'

export { listPipelines, type PipelineId } from './pipelines'

export type Engine = 'codex' | 'claude' | 'cursor' | 'openrouter'

export type AgentModelPolicy = {
  default?: string
  cheap?: string
  deep?: string
  judge?: string
  allowOverride?: boolean
}

export type AgentCheck = {
  id: string
  title: string
  command: string
  cwd?: 'repo' | 'worktree'
  required?: boolean
  timeoutMs?: number
}

export type AgentJudge = {
  enabled?: boolean
  mode?: 'deterministic' | 'llm' | 'hybrid'
  model?: string
  rubric?: string[]
  passThreshold?: number
}

export type AgentQuality = {
  acceptanceCriteria?: string[]
  requiredArtifacts?: string[]
  deterministicChecks?: AgentCheck[]
  judge?: AgentJudge
}

export type AgentRunEvaluationCheck = {
  id: string
  title: string
  command?: string
  status: 'pass' | 'fail' | 'skipped'
  required?: boolean
  detail?: string
}

export type AgentRunEvaluation = {
  status: 'pass' | 'fail' | 'incomplete'
  evaluatedAt: number
  summary: string
  checks: AgentRunEvaluationCheck[]
  judge?: {
    enabled: boolean
    mode: AgentJudge['mode']
    status: 'not-run'
    model?: string
    detail: string
  }
}

export type AgentRunTrace = {
  ticketSlug?: string
  ticketId?: number
  ticketRef?: string
  prIid?: number
  prKind?: 'review' | 'iterate'
  sourceBranch?: string
  /** Set when this run is one of N parallel variant attempts ("lanes") of a
   *  ticket. `group` ties the lanes together; index/total are 1-based. */
  lane?: { group: string; index: number; total: number }
}

export type AgentDefinition = {
  id: string
  ref: { id: string; scope: 'repo' | 'global'; kind: 'classic' | 'persistent' }
  title: string
  description?: string
  icon?: string
  scope: 'repo' | 'global'
  kind: 'classic' | 'persistent'
  source: 'default' | 'repo-override' | 'global-override' | 'repo' | 'global' | 'persistent'
  runtime: {
    engine?: Engine
    model?: string
    modelPolicy?: AgentModelPolicy
    mode: 'prompt' | 'script' | 'persistent'
    scriptPath?: string
    memoryDir?: string
    inPlace?: boolean
    opensPr?: boolean
    force?: boolean
  }
  instructions: {
    prompt?: string
    system?: string
    knowledgePolicy?: 'minimal' | 'standard' | 'deep'
    outputContract?: string
  }
  quality: AgentQuality
  metadata: {
    tags?: string[]
    createdAt?: number
    updatedAt?: number
    lastRunAt?: number
  }
}

// On-demand Codex agents. Each runs in its own git worktree off the default
// branch; codex does the work, files tickets, and opens the PR itself. We just
// orchestrate the worktree + process and stream the output.

export type Agent = {
  id: string
  title: string
  description?: string
  icon?: string
  prompt: string
  opensPr?: boolean
  engine?: Engine // default engine; overridable per run
  // Per-engine model alias (claude: "haiku"|"sonnet"|"opus"; codex: model name
  // like "gpt-5-codex", "gpt-5", "o4-mini"). undefined → engine default. Lets
  // lightweight agents (health, deps audit) avoid burning the biggest model.
  model?: string
  modelPolicy?: AgentModelPolicy
  quality?: AgentQuality
  outputContract?: string
  acceptanceCriteria?: string[]
  // Computed by readAgents: true when .agents/<id>.sh (or the global script)
  // exists. The runner branches on this — UI uses it for a "sh" badge so
  // operators can see at a glance which agents are script-first.
  hasScript?: boolean
  // Run directly in the repo (no fresh worktree) — e.g. orchestrators like
  // /factory that manage their own worktrees internally, or quick additive ops.
  inPlace?: boolean
  // FORCE MODE — the runner sets TERMINAL_FORCE_MAIN=1 in the child env so the
  // global block-main-merge hook lets the agent push to / merge into main.
  // The prompt is auto-prepended with a FORCE preamble so the agent's own
  // skills don't refuse. UI labels these with a red FORCE chip. Reserve for
  // genuine emergencies — every other agent should go through the PR/MR gate.
  force?: boolean
  // provenance (set by readAgents): a built-in default, a default overridden by
  // this repo's .agents/agents.json, a repo-only agent, a global agent
  // (~/.config/TerMinal/agents/global.json), or a default overridden globally.
  source?: 'default' | 'repo-override' | 'global-override' | 'repo' | 'global'
}

export type AgentRunContext = Persona

export type AgentRunStatus = 'running' | 'done' | 'failed' | 'canceled' | 'interrupted'
export type AgentRun = {
  id: string
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string
  persona?: string
  pipeline?: string // display label when this run chained multiple stages
  rerun?: RerunSpec
  status: AgentRunStatus
  startedAt: number
  endedAt?: number
  exitCode?: number
  repoRoot: string
  worktree: string
  branch: string
  output: string
  /** USD cost of the run when the harness reports it (OpenRouter/or-agent). */
  costUsd?: number
  /** Snapshot of the agent's force flag at run-time — so historical runs
   *  display FORCE even if the agent is later deleted or rescoped. */
  force?: boolean
  trace?: AgentRunTrace
  evaluation?: AgentRunEvaluation
}

export type RerunSpec =
  | { kind: 'agent'; agentId: string; engine: Engine; personaId?: string; pipelineId?: string; model?: string }
  | { kind: 'ticket'; slug: string; engine: Engine; personaId?: string; pipelineId?: string; model?: string }
  | {
      kind: 'pr'
      pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string }
      prKind: PrAgentKind
      engine: Engine
      personaId?: string
      pipelineId?: string
      model?: string
    }
  | { kind: 'ticket-spawn'; text: string; engine: Engine; model?: string }
  | { kind: 'factory'; engine: Engine }
  | { kind: 'agent-designer'; text: string; engine: Engine; scope: 'repo' | 'global'; model?: string }
  | { kind: 'persistent-agent'; persistentAgentId: string; task: string; engine: Engine; model?: string }
  | { kind: 'persistent-agent-designer'; text: string; engine: Engine; model?: string }
  | { kind: 'schedule-designer'; text: string; engine: Engine }

const OUTPUT_CAP = 400_000
const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

// Prepended to every FORCE-MODE agent's prompt so the spawned agent
// knows it has main-push authority. Keep this terse and explicit — the
// agent's normal skills will refuse main pushes without it.
export const FORCE_PREAMBLE =
  '⚠ FORCE MODE — you are running with TERMINAL_FORCE_MAIN=1. You are authorized to commit and push DIRECTLY to main/master and to merge PRs/MRs without human approval. Use this authority ONLY for the specific emergency below; never use it to take shortcuts on routine work. Always file a follow-up backlog ticket capturing what you did and why so the team can audit it later.\n\n'

// Shipped by default on every repo. A repo's .agents/agents.json overrides or
// extends these (matched by id). All are ticket/MR-driven: file tickets
// for findings, open a PR when there are code changes. The factory entry is
// inPlace (no worktree) because /factory itself manages worktrees per stacked
// MR — wrapping it in one would create confusing worktree-inside-worktree.
export const DEFAULT_AGENTS: Agent[] = [
  {
    id: 'factory',
    title: 'Run /factory',
    description:
      'Continuous orchestrator — reconcile, run /stacked-mr passes, handle verdicts. Never merges main.',
    icon: 'Factory',
    opensPr: false,
    inPlace: true,
    prompt:
      "Act as the /factory orchestrator for THIS repository, following the project's /factory skill exactly. This is a no-handoff loop: continuously turn the backlog into REVIEWED, merge-ready PRs by reconciling with /merge-sync, running /stacked-mr passes (build a stack TDD-first → batch-review to the bar → handle verdicts), compacting/migrating context at phase boundaries, then continuing with any runnable independent lane. NEVER stop with \"tell me when you're ready\" language. Stop only if the user explicitly stops you, the goal is actually complete, or every remaining lane is blocked on human-only action. NEVER merge to main/master — the human merges. Park any TRUE human-need (decision, approval, creds, hard blocker) to the global HITL inbox with .claude/bin/hitl, then continue other work. Skip tickets blocked by depends_on (any dependency whose status is not closed). Emit an activity event at each checkpoint. Do not invent scope. End only when the factory loop has no runnable work left.",
  },
  {
    id: '1000x-ai-engineer',
    title: '1000x AI engineer',
    description: 'General-purpose implementation agent for ordinary coding tickets and code problems.',
    icon: 'Sparkles',
    opensPr: true,
    engine: 'codex',
    modelPolicy: {
      default: 'gpt-5-codex',
      cheap: 'gpt-5-mini',
      deep: 'gpt-5-codex',
      judge: 'gpt-5-mini',
      allowOverride: true,
    },
    outputContract:
      'Focused implementation PR linked to the source ticket, with tests or a clear verification note and follow-up tickets for work outside scope.',
    quality: {
      acceptanceCriteria: [
        'Read the ticket, repo instructions, and relevant existing code before editing.',
        'Implement the smallest coherent change that fully satisfies the ticket.',
        'Add or update meaningful tests for changed behavior when the repo has a test surface.',
        'Run the relevant typecheck, test, lint, or build commands and report exact results.',
        'Open a PR/MR linked to the ticket, or explain why no code change was needed.',
        'File follow-up tickets for adjacent work instead of expanding scope.',
      ],
      requiredArtifacts: ['implementation diff', 'verification output', 'PR/MR link or no-change rationale'],
      deterministicChecks: [
        {
          id: 'repo-clean-diff-reviewed',
          title: 'Diff reviewed before handoff',
          command: 'git diff --check',
          cwd: 'worktree',
          required: true,
        },
      ],
      judge: {
        enabled: true,
        mode: 'llm',
        rubric: [
          'The implementation directly satisfies the ticket without speculative scope.',
          'The diff matches existing repo style and keeps unrelated files untouched.',
          'Verification is appropriate for the risk and blast radius.',
          'Follow-up tickets are filed for cross-agent or out-of-scope work.',
        ],
      },
    },
    prompt:
      'Act as a 1000x AI engineer implementation agent for this repository. Own exactly one generic coding ticket or code problem end to end: read the ticket and repo instructions, gather relevant knowledge first, inspect the existing implementation, choose the smallest coherent approach, make the code change, add or update meaningful tests when a test surface exists, run the relevant verification commands, commit, and open a PR/MR linked to the ticket. Prefer existing patterns over new abstractions. Keep changes tightly scoped; do not refactor unrelated code. If the ticket reveals separable work better owned by another specialist agent, file follow-up tickets assigned to those agents instead of expanding this PR. End with the PR/MR URL, verification results, and any follow-up ticket ids.',
  },
  {
    id: 'docs',
    title: 'Improve docs',
    description: 'Generate/improve developer-facing documentation, then open a PR.',
    icon: 'BookText',
    opensPr: true,
    prompt:
      "Act as the documentation agent for technical developers. Improve and generate developer-facing documentation for this repository: README, docs/architecture.md, docs/runbooks, ADRs/learnings, and sidecar docs where behavior is undocumented or stale. Sweep recent git history for undocumented changes. Make accurate, surgical edits — never invent behavior. Then commit your changes and open a PR with a clear summary. For larger documentation gaps you can't finish in one pass, file a backlog ticket each (type: docs). End with a summary of the PR and any tickets filed.",
  },
  {
    id: 'deep-audit',
    title: 'Deep audit',
    description: 'Audit the codebase; file a ticket per finding, PR any safe fixes.',
    icon: 'ScanSearch',
    opensPr: true,
    prompt:
      'Act as a deep-audit agent for this repository. Thoroughly audit the codebase across correctness, security, architecture, performance, dead code, and dependency hygiene. For EVERY notable finding, file a backlog ticket (one per finding) with an accurate title, a type (bug/security/performance/dx/etc.), a priority, a specific description citing files and lines, and a self-contained agent-runnable fix prompt. Prefer filing tickets over making changes. If you apply any safe, self-contained fixes during the audit, commit them and open a PR. Do not make sweeping refactors. End with a summary listing every ticket filed (by id) and the PR if one was opened.',
  },
  {
    id: 'ticket-pr-cleanup',
    title: 'Ticket / PR cleanup',
    description: 'Reconcile the backlog + open PRs; close/dedupe/fix, file follow-ups, PR changes.',
    icon: 'ListChecks',
    opensPr: true,
    prompt:
      'Act as the ticket & PR cleanup agent for this repository. Review the backlog/ tickets and the open PRs, and reconcile them with reality: close or icebox stale, duplicate, or obsolete tickets (add a brief closing note to each), fix inconsistent or missing metadata (status, priority, type, horizon), and close tickets whose work already shipped (unlink merged PRs). File new tickets for any gaps or follow-ups you discover. If your cleanup changes ticket files or code, commit and open a PR. End with a summary of what you closed, edited, and filed, plus the PR if one was opened.',
  },
  {
    id: 'test-coverage',
    title: 'Strengthen tests',
    description: 'Add meaningful tests for under-tested behavior, then open a PR.',
    icon: 'TestTube2',
    opensPr: true,
    prompt:
      'Act as a test-coverage agent for this repository. Identify the most important under-tested or untested behavior (prioritize core logic, error paths, and recently-changed code) and add meaningful, adversarial tests that would catch real regressions — no tautological or implementation-mirroring assertions. Follow the project test runner and conventions, keep changes surgical, and make sure new tests exercise a real entry point. Commit and open a PR. For larger coverage gaps you cannot finish in one pass, file a backlog ticket each (type: testing). End with a summary of what you covered and the PR URL.',
  },
  {
    id: 'code-review',
    title: 'Code review',
    description: 'Review one PR/MR with tests-as-gate, six-axis scoring, findings, and durable artifacts.',
    icon: 'ScanSearch',
    opensPr: false,
    engine: 'codex',
    modelPolicy: {
      default: 'gpt-5-codex',
      cheap: 'gpt-5-mini',
      deep: 'gpt-5-codex',
      judge: 'gpt-5-mini',
      allowOverride: true,
    },
    outputContract:
      'One combined review artifact plus findings/suggestions state in .TerMinal/reviews/<pr>/<sha> or legacy .reviews/<pr>.',
    quality: {
      acceptanceCriteria: [
        'Resolve exactly one PR/MR and review the current head commit.',
        'Run the detected test suite first and block the verdict when tests fail.',
        'Score correctness, security, architecture, conformance, quality, and dependencies.',
        'Write the review artifact and findings/suggestions state in the repo review artifact location.',
        'File owner-scoped follow-up tickets for out-of-scope work instead of fixing it inside the review.',
      ],
      requiredArtifacts: ['review artifact', 'findings.json', 'suggestions.json'],
      deterministicChecks: [
        {
          id: 'review-artifact-written',
          title: 'Review artifact is written',
          command: 'test -d .TerMinal/reviews -o -d .reviews',
          cwd: 'worktree',
          required: true,
        },
      ],
      judge: {
        enabled: false,
        mode: 'deterministic',
        rubric: [
          'Tests are treated as a hard gate.',
          'Findings cite concrete evidence and affected paths.',
          'Verdict follows the in-repo review contract.',
        ],
      },
    },
    prompt:
      'Act as the code-review agent for this repository. Review exactly one PR/MR at its current head commit. Follow the in-repo review contract at .agents/code-review.md when present; otherwise use this fallback contract: run the detected test suite first as a hard gate, inspect the PR/MR diff against its target branch, score correctness/security/architecture/conformance/quality/dependencies, write a durable review artifact under .TerMinal/reviews/<number>/<short-sha>.md (legacy v1 repos may use .reviews/<number>/<short-sha>.md), and update findings.json plus suggestions.json when the project has those helpers. Do not implement fixes during review. If you find out-of-scope work, file owner-scoped follow-up tickets using list_agents before assigning. End with verdict, artifact path, test status, and key findings.',
  },
  {
    id: 'security-sweep',
    title: 'Security sweep',
    description: 'Focused security audit; ticket per finding, PR the safe fixes.',
    icon: 'ShieldAlert',
    opensPr: true,
    prompt:
      'Act as a focused security-sweep agent for this repository. Audit for exploitable vulnerabilities: injection (SQL/command/template), XSS/SSRF, broken authentication/authorization, insecure deserialization, secrets committed in code or git history, unsafe file/path handling, and vulnerable dependencies. For every finding, file a backlog ticket (type: security) with a precise title, a severity-aware priority, the affected files/lines, and a self-contained agent-runnable fix prompt. Apply only clearly-safe, self-contained fixes (with tests) and open a PR for those. End with a summary listing every ticket filed and the PR if one was opened.',
  },
  {
    id: 'perf-pass',
    title: 'Performance pass',
    description: 'Find + fix the highest-impact runtime/memory issues; PR the wins.',
    icon: 'Gauge',
    opensPr: true,
    prompt:
      'Act as a performance agent for this repository. Find the highest-impact runtime and memory issues — N+1 queries, accidentally-quadratic loops, redundant work in hot paths, missing batching/streaming, and avoidable allocations. Measure before/after where feasible and record the numbers. Apply safe, well-scoped optimizations with tests (do not trade readability for marginal gains) and open a PR. File a backlog ticket (type: performance) for any larger optimization you cannot safely land in one pass. End with a summary of the wins and the PR URL.',
  },
  {
    id: 'dep-upgrade',
    title: 'Dependency hygiene',
    description: 'Audit deps; bump safe pinned versions; PR with lockfile.',
    icon: 'PackageCheck',
    opensPr: true,
    prompt:
      'Act as a dependency-hygiene agent for this repository. Audit dependencies for known vulnerabilities and staleness. Upgrade safe, low-risk dependencies — pin exact versions (no ^ or ~), commit the lockfile, and only adopt versions at least 3 days old (a security-critical CVE fix may override the age rule; note it in the commit). Run the project audit and full test suite to confirm nothing breaks, then open a PR. File a backlog ticket for any risky or major upgrade that needs human judgment. End with a summary of what was bumped and the PR URL.',
  },
  {
    id: 'dead-code',
    title: 'Dead-code cleanup',
    description: 'Remove provably-unused code safely; ticket the uncertain; PR.',
    icon: 'Eraser',
    opensPr: true,
    prompt:
      'Act as a dead-code cleanup agent for this repository. Find unused exports, unreachable branches, orphaned files, and stale feature flags. Remove only what is provably unused (verify with a references/usage search and the type checker/build), keeping changes surgical and reversible. Run the test suite and build to confirm nothing breaks, then open a PR. For anything you suspect is dead but cannot prove safely, file a backlog ticket instead of deleting. End with a summary of what you removed and the PR URL.',
  },
  // ━━ Generic daily-loop presets (modeled on Trevor's old BitBadges daily) ━━
  // Each preset is repo-agnostic and ticket/PR-driven. Skipping presets that
  // overlap existing defaults (auto-docs → docs, auto-test → test-coverage,
  // security-audit → security-sweep, perf-infra → perf-pass, dependabot →
  // dep-upgrade, auto-fix → deep-audit+ticket-pr-cleanup).
  {
    id: 'comments-inspector',
    title: 'Comments inspector',
    description: 'Audit READMEs, CLAUDE.md, JSDoc, inline comments for staleness or low-value noise.',
    icon: 'MessageSquare',
    opensPr: true,
    prompt:
      "Act as a comments-quality agent for this repository. Audit in-repo READMEs (root + nested), CLAUDE.md files, JSDoc / docstrings, and inline comments. Flag: WHAT-comments that just restate the code (delete-candidate per global §7 — code should self-document), stale comments that contradict current behavior, missing WHY-comments where a non-obvious constraint or invariant would surprise a reader, and incorrect/outdated docs at the top of files. Apply only safe, surgical changes (delete dead WHAT-comments, fix wrong-vs-code comments). File a backlog ticket (type: docs) for larger rewrites you can't do in one pass. Open a PR for any changes. End with a summary of fixes + tickets filed.",
  },
  {
    id: 'product-audit',
    title: 'Product audit',
    description: 'Static product/UX read — features, flows, copy, IA. File tickets for gaps.',
    icon: 'ClipboardList',
    opensPr: false,
    prompt:
      "Act as a product-audit agent for this repository. Without running the app, do a static read of the product surface: routes, screens/components, copy, navigation/IA, primary user flows, and onboarding. Identify product gaps — missing affordances, confusing copy, broken/half-built flows, inconsistencies across surfaces, and accessibility issues visible from the source. For each finding, file a backlog ticket (type: ux or feature) with a precise title, the affected files, and a self-contained fix prompt. Don't edit code. End with a summary of every ticket filed.",
  },
  {
    id: 'friction-hunter',
    title: 'Friction hunter',
    description: 'Walk onboarding/first-use as a new user; file tickets where things confuse or break.',
    icon: 'Footprints',
    opensPr: false,
    prompt:
      "Act as a friction-hunter agent for this repository. Pretend you are a brand-new user encountering this product for the first time. Walk the onboarding / first-use path end-to-end — read the README, attempt the setup, run the first flow (CLI command, route, UI). Note every point of friction: ambiguous instructions, missing steps, errors with poor messages, half-wired features, dead links, broken happy paths. For each friction point, file a backlog ticket (type: ux or bug) with the exact reproduction and a fix prompt. Don't edit code. End with a numbered list of friction points + ticket ids.",
  },
  {
    id: 'red-team-audit',
    title: 'Red-team audit',
    description: 'Adversarial cross-layer sweep — chain weaknesses, abuse cases, real attacker mindset.',
    icon: 'Swords',
    opensPr: false,
    prompt:
      "Act as a red-team agent for this repository. Unlike a per-vector security sweep, do an ADVERSARIAL cross-layer audit: think like a motivated attacker trying to chain small weaknesses into a real compromise. Look at auth + session flow + state mutation + IPC + external calls as a SYSTEM, not in isolation. Identify abuse cases (rate-limit bypass, race conditions on the auth boundary, trust assumptions that don't hold under concurrency, side-channel leaks). File a backlog ticket per attack-chain (type: security) with the chain laid out step-by-step and the smallest fix that breaks the chain. Don't edit code. End with the list of attack chains and ticket ids.",
  },
  {
    id: 'intelligence',
    title: 'Intelligence sweep',
    description: 'Scan for market / competitor / ecosystem signals relevant to this project.',
    icon: 'Telescope',
    opensPr: false,
    prompt:
      "Act as an intelligence-gathering agent for this repository. Identify what this product/codebase does (from README, package.json, code) and then sweep for relevant external signals: competitor moves, ecosystem/protocol updates, new libraries that obsolete current dependencies, market shifts that change the priority of in-flight work. Use whatever web/search tools you have. File a backlog ticket per actionable signal (type: feature or docs, horizon: future or next) with the source link and the implication. Don't edit code. End with a digest of signals + ticket ids.",
  },
  {
    id: 'strategy',
    title: 'Strategy review',
    description: 'Step back: are we building the right things? Surface drift from stated goals.',
    icon: 'Target',
    opensPr: false,
    prompt:
      "Act as a strategy-review agent for this repository. Step back from execution and assess direction: read the README, architecture.md, ADRs, recent commits, and the open backlog. Identify drift between stated goals and actual work, abandoned-but-not-formally-deprioritized lines, and missing strategic bets the codebase implies but doesn't pursue. File backlog tickets (type: docs for ADR candidates, type: feature for missing strategic moves) — never edit code. Write the substantive strategic read (alignment vs. drift assessment + top 3 strategic moves) to .TerMinal/reports/YYYY-MM-DD-strategy-read.md (create .TerMinal/reports/ if missing; legacy v1 repos may use reports/). End with the report path and the ticket ids filed.",
  },
  {
    id: 'cert-check',
    title: 'TLS / cert check',
    description: 'Check production TLS expiry + cert hygiene for any prod hostnames this repo serves.',
    icon: 'Lock',
    opensPr: false,
    prompt:
      "Act as a TLS-hygiene agent for this repository. Find every production hostname this repo serves (from deployment manifests, docker-compose, k8s yaml, .env.example, docs). For each hostname, probe its TLS certificate (openssl s_client or equivalent) and check: days-until-expiry, certificate chain validity, hostname match, and minimum TLS version. File a backlog ticket (type: security or dx) for any cert expiring within 30 days, mismatched cert, or weak TLS config. Don't edit code. Write the full hostname / expiry / chain / TLS-version table to .TerMinal/reports/YYYY-MM-DD-cert-check.md (create .TerMinal/reports/ if missing; legacy v1 repos may use reports/) — durable snapshot of cert hygiene, not just the flagged issues. End with the report path and the ticket ids filed.",
  },
  {
    id: 'translations-check',
    title: 'Translations check',
    description: 'Find hardcoded English strings + drifted locale files; file tickets for gaps.',
    icon: 'Languages',
    opensPr: false,
    prompt:
      "Act as a translations-hygiene agent for this repository. Determine if this product uses i18n (look for next-intl, react-i18next, formatjs, locale files under src/locales or similar). If not, no-op and report. If yes, scan for: hardcoded user-facing English strings that bypass the i18n system, missing keys in non-default locale files, stale translations where the source key changed, and untranslated UI surfaces. File a backlog ticket per gap (type: ux or docs) with the affected files and a fix prompt. Don't edit code. End with the gap summary and ticket ids.",
  },
  {
    id: 'changelog',
    title: 'Changelog update',
    description: 'Roll recent merged commits/PRs into a CHANGELOG entry; PR the result.',
    icon: 'ScrollText',
    opensPr: true,
    prompt:
      "Act as a changelog agent for this repository. If a CHANGELOG.md or similar exists, identify the last release entry date and roll all merged work since then into a new Unreleased (or next-version) section: features, fixes, breaking changes, internal/chore. Pull from git log + closed PRs + closed backlog tickets. Use Conventional Commits prefixes to bucket. Keep entries user-facing — drop pure refactors unless they change behavior. Commit and open a PR. If no CHANGELOG exists, file a docs ticket proposing one rather than creating it unilaterally. End with the entry diff summary and PR URL.",
  },
  {
    id: 'simplification',
    title: 'Simplification pass',
    description: 'Find over-engineering / premature abstraction; PR safe simplifications.',
    icon: 'Scissors',
    opensPr: true,
    prompt:
      "Act as a simplification agent for this repository. Find over-engineering per global §2: speculative flexibility, single-use abstractions, configurability nobody uses, error handling for impossible scenarios, generic helpers that wrap one call site. Apply safe, well-scoped simplifications with tests still green (rewrite a 200-line module to 50 only when it stays readable and equivalent). File backlog tickets (type: refactor or dx) for larger simplifications you can't safely land. Open a PR for what you simplify. End with a list of what was simplified (lines before/after) + tickets filed + PR URL.",
  },
  {
    id: 'devils-advocate',
    title: "Devil's advocate",
    description: 'Counter-argue a recent decision/ADR; file a ticket if the counter holds.',
    icon: 'MessageCircleQuestion',
    opensPr: false,
    prompt:
      "Act as a devil's-advocate agent for this repository. Pick the most consequential recent decision — last accepted ADR, last significant architecture commit, last major feature direction — and build the strongest counter-argument. Steelman the opposite choice: what would have made it correct, what costs the chosen path now carries, what's the smallest reversal that would unwind it. Always write the full counter-argument to .TerMinal/reports/devils-advocate/YYYY-MM-DD-<slug>.md (create .TerMinal/reports/devils-advocate/ if missing; legacy v1 repos may use reports/devils-advocate/) so the steelman is durable, not chat-only. Only if the counter holds enough water that reconsideration would be cheaper than the eventual reversal, additionally file a backlog ticket (type: docs, source: devils-advocate) proposing an ADR-revisit and linking the report. Don't edit code. End with the report path and the ticket id (if filed).",
  },
  {
    id: 'bloat-check',
    title: 'Bloat check',
    description: 'Delete low-value tickets, suggestions, and dead artifacts. Keep the backlog honest.',
    icon: 'Recycle',
    opensPr: false,
    prompt:
      "Act as a bloat-check agent for this repository. Audit the backlog and artifact surfaces — open tickets, .TerMinal/reviews/ suggestions, .TerMinal/checks/ reports, .TerMinal/sessions/ closed docs, plus legacy v1 .reviews/.checks/sessions if present — for low-value or stale items: tickets nobody will ever do, suggestions copy-pasted into ticket form, reports older than the work they discuss, abandoned session docs. Close (with a one-line closing note) or icebox the cruft. Don't delete prose lightly; preserve genuinely useful learnings. End with a list of every item closed/iceboxed and the rationale.",
  },
  {
    id: 'knowledge-base',
    title: 'Knowledge base sweep',
    description: 'Cross-link, deduplicate, surface gaps across ADRs / learnings / runbooks.',
    icon: 'Library',
    opensPr: true,
    prompt:
      "Act as a knowledge-base agent for this repository. Sweep docs/decisions/, docs/learnings/, and docs/runbooks/ for: duplicate entries (same gotcha captured twice), missing cross-links between related items, ADRs that should be superseded by newer ones but aren't marked, runbooks whose last-verified date is stale. Apply safe edits (add cross-link references, mark stale runbooks, set supersedes: on duplicate ADRs). File backlog tickets (type: docs) for any gap you find — a learning that should exist for a known recurring issue, a runbook that should exist for a manual procedure. Open a PR for the safe edits. End with a summary.",
  },
  {
    id: 'ci-improver',
    title: 'CI improver',
    description: 'Observe CI runs since last run; file tickets + PR safe fixes for failures and flakes.',
    icon: 'Workflow',
    opensPr: true,
    prompt:
      "Act as a CI-improver agent for this repository. Observe recent CI runs (workflow / pipeline runs) since this agent last ran. Use the TerMinal MCP tools to track state: read the saved checkpoint via get_agent_state (key: 'last_run_id') and default to the newest 30 runs if no checkpoint exists. For each failed or flaky run (same step / job failing intermittently across runs in the window): pull the failing job's log, identify the root cause (test failure, build error, dep install error, timeout, infra issue, flake), and route the finding durably — never chat-only. File a backlog ticket per distinct failure pattern (type: testing for test failures, type: ci for build/infra, type: bug for runtime issues, type: dependency for dep/install issues) with the failing workflow/pipeline + job + step, the error excerpt, and a self-contained agent-runnable fix prompt. For SAFE, well-scoped fixes (pin a flapping dep, bump a known-too-tight timeout, add retry to a documented-flaky step, fix a hard-coded path) apply them with tests still green and open a PR. For flakes you can identify but not safely fix (timing-dependent tests, infra flake), file a ticket only and tag horizon: next. After processing, save the newest observed run id via set_agent_state (key: 'last_run_id') so the next run only inspects newer runs — this is the watermark that keeps each invocation cheap. End with a summary of failures classified, tickets filed (by id), and PR URL if one was opened.",
  },
  {
    id: 'summary',
    title: 'Daily summary',
    description: 'Roll up today\'s repo activity into a concise digest under reports/.',
    icon: 'Newspaper',
    opensPr: false,
    prompt:
      "Act as a daily-summary agent for this repository. Produce a concise digest of TODAY's activity: merged commits + closed PRs, opened tickets, closed tickets, code-review verdicts, check artifacts, agent runs. Pull from git log, gh/glab, .TerMinal/backlog/, .TerMinal/reviews/, .TerMinal/checks/, plus legacy v1 paths if present. Write it to .TerMinal/reports/YYYY-MM-DD-daily-summary.md (create .TerMinal/reports/ if missing; legacy v1 repos may use reports/). Keep it scannable — one section per category, short bullets, links to underlying artifacts. Don't edit code. Don't open a PR (the report is committed directly to main? — actually no, follow the project's branching rule; if main is protected, drop the file uncommitted and report the path). End with the path to the digest.",
  },
  // ── FORCE agents ─────────────────────────────────────────────────────────
  // These bypass the main-branch gate via TERMINAL_FORCE_MAIN=1. Reserved
  // for production emergencies. Marked `force: true` so the runner injects
  // the env var, prepends the FORCE preamble to the prompt, and the UI
  // shows a red FORCE chip.
  {
    id: 'emergency-fix',
    title: 'Emergency fix',
    description: 'Production hotfix: smallest patch, commit + push direct to main, file follow-up ticket.',
    icon: 'AlertOctagon',
    opensPr: false,
    force: true,
    prompt:
      "Act as an emergency-fix agent for THIS repository. A production-impacting bug is breaking real users RIGHT NOW. Identify the SMALLEST POSSIBLE PATCH that stops the bleeding — not the proper fix, not a refactor, not the cleanup. Sequence: (1) reproduce the failure briefly to confirm scope; (2) write the minimum surgical change; (3) run the existing test suite (or the most relevant subset) and confirm it stays green; (4) commit on main with a `fix:` Conventional Commits subject mentioning what was breaking; (5) push directly to main (`git push origin main`) — you are authorized; (6) file a backlog ticket (type: bug, priority: high, source: emergency-fix) describing the real root cause and a proper fix prompt for /factory to handle later. Never expand scope. Never touch unrelated code. If the smallest patch isn't obvious within ~5 minutes of investigation, abort and file a critical ticket instead — paged humans are cheaper than a broken hotfix. End with the SHA you pushed, the brief explanation, and the follow-up ticket id.",
  },
  {
    id: 'unblock-ci',
    title: 'Unblock CI',
    description: 'Main CI is red. Diagnose; revert, pin, or skip the hosed bit; push direct to main.',
    icon: 'ShieldAlert',
    opensPr: false,
    force: true,
    prompt:
      "Act as an unblock-CI agent for THIS repository. The default-branch CI run is RED and blocking the whole team. Your job: get main green so other PRs can merge. Sequence: (1) pull the latest main and the failing CI run's logs (use TerMinal MCP CI tools or `gh run view` / `glab ci view`); (2) classify the failure — is it (a) a regression from the last merge, (b) a flapping test, (c) a dep / install break, or (d) infra? (3) apply the narrowest fix that turns main green: prefer `git revert <bad-sha>` for a regression; for a true flake, mark the test with the project's skip/retry convention; for a dep break, pin the working version; for infra, file a ticket and exit. (4) Run the suite locally to confirm green; (5) commit on main and push directly (`git push origin main`); (6) file a follow-up ticket (type: testing or ci or dependency, priority: high) explaining what was broken and what the proper fix is. Never roll forward an unrelated change. If the failure is genuinely outside your fix budget, file a ticket and exit — do not paper over a real bug. End with the action taken (reverted SHA / pinned version / skipped test path), the new main SHA, and the follow-up ticket id.",
  },
  {
    id: 'revert-main',
    title: 'Revert last main commit',
    description: 'Narrow force-op: git revert the most recent main commit and push.',
    icon: 'Undo2',
    opensPr: false,
    force: true,
    prompt:
      "Act as a revert-main agent for THIS repository. The most recent commit on main is bad and must be undone. Sequence: (1) confirm you're on the latest main and identify HEAD's SHA + commit message; (2) run `git revert --no-edit HEAD` to produce a revert commit; (3) run the existing test suite to confirm the revert lands cleanly; (4) push directly to main (`git push origin main`) — you are authorized; (5) file a backlog ticket (type: bug, priority: high, source: revert-main) titled `Re-do reverted: <original subject>` with the reverted SHA + reason for the revert + a fix prompt so /factory can re-attempt the change properly. Refuse if HEAD is already a revert (would be a no-op or destructive). Refuse if HEAD is more than 24h old (the team has likely moved on and a straight revert may be wrong). End with the reverted SHA, the new main SHA, and the follow-up ticket id.",
  },
]

function readRepoAgents(repoRoot: string): Agent[] {
  const f = join(repoRoot, '.agents', 'agents.json')
  if (!existsSync(f)) return []
  try {
    const a = JSON.parse(readFileSync(f, 'utf8'))
    const list = Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : []
    return list.filter((x: Agent) => x && x.id && x.title && x.prompt)
  } catch {
    return []
  }
}

/** Built-in defaults, with the repo's .agents/agents.json overriding by id.
 *  Each agent is annotated with its `source` so the UI can distinguish a stock
 *  default, a default this repo has customized, and a repo-only agent. */
// Discover script-only agents from a directory: any `<id>.sh` paired with an
// optional sidecar `<id>.json` of metadata. No JSON entry in agents.json
// required — drop the .sh and the agent shows up.
function readScriptAgents(dir: string): Agent[] {
  if (!existsSync(dir)) return []
  const out: Agent[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  for (const f of entries) {
    if (!f.endsWith('.sh')) continue
    const id = f.slice(0, -3)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) continue
    // Sidecar JSON (optional) provides metadata; otherwise we synthesize sane defaults.
    let meta: Partial<Agent> = {}
    const sidecar = join(dir, `${id}.json`)
    if (existsSync(sidecar)) {
      try {
        meta = JSON.parse(readFileSync(sidecar, 'utf8'))
      } catch {
        /* malformed sidecar — fall back to defaults */
      }
    }
    out.push({
      id,
      title: meta.title || id,
      description: meta.description,
      icon: meta.icon || 'Wrench',
      // The prompt is the canonical "what does this agent do" surface in the UI;
      // for script-only agents we point at the file rather than duplicate the bash.
      prompt: meta.prompt || `Script-based agent · body in ${dir.replace(homedir(), '~')}/${f}`,
      opensPr: meta.opensPr,
      engine: meta.engine,
      model: meta.model,
      modelPolicy: meta.modelPolicy,
      quality: meta.quality,
      outputContract: meta.outputContract,
      acceptanceCriteria: meta.acceptanceCriteria,
      inPlace: meta.inPlace,
      force: meta.force,
    })
  }
  return out
}

export function readAgents(repoRoot: string): Agent[] {
  type Layered = { agent: Agent; layers: Set<'default' | 'global' | 'repo'> }
  const byId = new Map<string, Layered>()
  const hiddenDefaults = hiddenPresetIds('agents')
  const merge = (a: Agent, layer: 'default' | 'global' | 'repo') => {
    const existing = byId.get(a.id)
    if (existing) {
      existing.layers.add(layer)
      // later layer wins for individual fields (only override fields it sets)
      existing.agent = { ...existing.agent, ...a }
    } else {
      byId.set(a.id, { agent: { ...a }, layers: new Set([layer]) })
    }
  }
  // Layer order: defaults → global (json then scripts) → repo (json then scripts).
  // Script bodies are independent from the JSON metadata; the runtime branches
  // on file existence, but the agent list cares only about the merged metadata.
  for (const a of DEFAULT_AGENTS) if (!hiddenDefaults.has(a.id)) merge(a, 'default')
  for (const a of readGlobalAgents()) merge(a, 'global')
  for (const a of readScriptAgents(join(homedir(), '.config', 'TerMinal', 'scripts'))) merge(a, 'global')
  if (repoRoot) for (const a of readRepoAgents(repoRoot)) merge(a, 'repo')
  if (repoRoot) for (const a of readScriptAgents(join(repoRoot, '.agents'))) merge(a, 'repo')

  const out: Agent[] = []
  for (const { agent, layers } of byId.values()) {
    let source: Agent['source']
    if (layers.has('repo')) source = layers.has('default') || layers.has('global') ? 'repo-override' : 'repo'
    else if (layers.has('global')) source = layers.has('default') ? 'global-override' : 'global'
    else source = 'default'
    out.push({ ...agent, source, hasScript: !!locateScript(repoRoot, agent.id) })
  }
  return out
}

/** Upsert an agent into <repo>/.agents/agents.json (creates it). Overriding a
 *  built-in default = writing an entry with the same id. */
export function saveAgent(
  repoRoot: string,
  agent: Partial<Agent> & { id: string; title: string; prompt: string },
): { ok: true } | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  const id = (agent.id || '').trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { error: 'id must be kebab-case (a-z, 0-9, -)' }
  if (!agent.title?.trim()) return { error: 'title is required' }
  if (!agent.prompt?.trim()) return { error: 'prompt is required' }
  const entry: Agent = {
    id,
    title: agent.title.trim(),
    prompt: agent.prompt.trim(),
    description: agent.description?.trim() || undefined,
    icon: agent.icon || undefined,
    engine: agent.engine,
    model: agent.model?.trim() || undefined,
    modelPolicy: agent.modelPolicy,
    quality: agent.quality,
    outputContract: agent.outputContract?.trim() || undefined,
    acceptanceCriteria: agent.acceptanceCriteria,
    opensPr: agent.opensPr,
    inPlace: agent.inPlace,
    force: agent.force,
  }
  const dir = join(repoRoot, '.agents')
  const f = join(dir, 'agents.json')
  const list = readRepoAgents(repoRoot).filter((a) => a.id !== id)
  list.push(entry)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(f, JSON.stringify(list, null, 2) + '\n')
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** Remove an agent override from .agents/agents.json — a customized default
 *  reverts to the built-in; a repo-only agent is deleted. */
export function resetAgent(repoRoot: string, id: string): { ok: true } | { error: string } {
  const f = join(repoRoot, '.agents', 'agents.json')
  if (!existsSync(f)) return { ok: true }
  try {
    const list = readRepoAgents(repoRoot).filter((a) => a.id !== id)
    writeFileSync(f, JSON.stringify(list, null, 2) + '\n')
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// every git repo gets the default agents
export function hasAgents(repoRoot: string): boolean {
  return !!repoRoot
}

const runs = new Map<string, AgentRun>()
const procs = new Map<string, ChildProcess>()
let emit: (channel: string, payload: unknown) => void = () => {}
export function onAgentEvent(fn: (channel: string, payload: unknown) => void) {
  emit = fn
}

// --- persistence: one <id>.json (metadata) + <id>.log (output) per run --------
const RUNS_DIR = join(homedir(), '.config', 'TerMinal', 'agent-runs')
const KEEP_RUNS = 100
const metaPath = (id: string) => join(RUNS_DIR, `${id}.json`)
const logPath = (id: string) => join(RUNS_DIR, `${id}.log`)

function persistMeta(run: AgentRun) {
  try {
    mkdirSync(RUNS_DIR, { recursive: true })
    const { output: _o, ...meta } = run
    writeFileSync(metaPath(run.id), JSON.stringify(meta))
  } catch {
    /* best effort */
  }
}
function appendLog(id: string, chunk: string) {
  try {
    appendFileSync(logPath(id), chunk)
  } catch {
    /* best effort */
  }
}

// Load past runs from disk into memory at startup. Runs still marked 'running'
// were orphaned by an app quit → mark 'interrupted'. Prune to the newest N.
let loaded = false
export function loadPersistedRuns() {
  if (loaded) return
  loaded = true
  let files: string[] = []
  try {
    files = readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return
  }
  const metas: AgentRun[] = []
  for (const f of files) {
    try {
      const m = JSON.parse(readFileSync(join(RUNS_DIR, f), 'utf8')) as AgentRun
      if (m.status === 'running') m.status = 'interrupted'
      let output = ''
      try {
        const buf = readFileSync(logPath(m.id), 'utf8')
        output = buf.length > OUTPUT_CAP ? buf.slice(-OUTPUT_CAP) : buf
      } catch {
        /* no log */
      }
      metas.push({ ...m, output })
    } catch {
      /* skip corrupt */
    }
  }
  metas.sort((a, b) => a.startedAt - b.startedAt)
  // prune oldest beyond KEEP_RUNS (delete files too)
  while (metas.length > KEEP_RUNS) {
    const old = metas.shift()!
    try {
      rmSync(metaPath(old.id), { force: true })
      rmSync(logPath(old.id), { force: true })
    } catch {
      /* ignore */
    }
  }
  for (const m of metas) {
    if (runs.has(m.id)) continue // never clobber a live (in-memory) run
    runs.set(m.id, m)
    if (m.status === 'interrupted') persistMeta(m) // persist the corrected status
  }
}

function defaultBase(repoRoot: string): string {
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '')
  } catch {
    /* no origin HEAD */
  }
  for (const b of ['main', 'master']) {
    try {
      git(['rev-parse', '--verify', b])
      return b
    } catch {
      /* not present */
    }
  }
  return 'HEAD'
}

export function listRuns(): AgentRun[] {
  loadPersistedRuns()
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt)
}
export function getRun(id: string): AgentRun | null {
  return runs.get(id) ?? null
}

// Build the engine command. codex needs -C; claude uses cwd. Both run through a
// login shell so $PATH has brew/local bins, and with stdin = /dev/null (else
// they block reading "additional input from stdin" on an empty pipe).
// Locate an executable script for this agent. Per-repo wins over global so a
// repo can override a global agent's body. The runner branches: if a script
// exists, exec it with env vars; else fall back to the prompt-based agent
// prompt-wrap built by buildCmd().
const TERMINAL_BIN_DIR = join(homedir(), '.config', 'TerMinal', 'bin')
const GLOBAL_SCRIPTS_DIR = join(homedir(), '.config', 'TerMinal', 'scripts')
export function locateScript(repoRoot: string, agentId: string): string | null {
  const perRepo = join(repoRoot, '.agents', `${agentId}.sh`)
  if (existsSync(perRepo)) return perRepo
  const global = join(GLOBAL_SCRIPTS_DIR, `${agentId}.sh`)
  if (existsSync(global)) return global
  return null
}

// State sidecar — mirrors terminal-cli's path layout exactly:
//   ~/.config/TerMinal/agent-state/<repo-basename>/<agentId>.json
// We expose read + reset to the renderer so the Agents tab can surface
// "last scanned X ago" without users `cat`-ing the JSON.
const AGENT_STATE_DIR = join(homedir(), '.config', 'TerMinal', 'agent-state')
function agentStateFile(repoRoot: string, agentId: string): string {
  return join(AGENT_STATE_DIR, basename(repoRoot) || 'unknown', `${agentId}.json`)
}
export type AgentState = {
  lastScannedSha?: string
  lastScannedRef?: string
  lastRunAt?: number
  lastRunId?: string
  [key: string]: unknown
}
export function readAgentState(
  repoRoot: string,
  agentId: string,
): { path: string; exists: boolean; state: AgentState } {
  const path = agentStateFile(repoRoot, agentId)
  if (!existsSync(path)) return { path, exists: false, state: {} }
  try {
    return { path, exists: true, state: JSON.parse(readFileSync(path, 'utf8')) as AgentState }
  } catch {
    return { path, exists: true, state: {} }
  }
}
export function resetAgentState(repoRoot: string, agentId: string): { ok: true } | { error: string } {
  const path = agentStateFile(repoRoot, agentId)
  if (!existsSync(path)) return { ok: true }
  try {
    unlinkSync(path)
    return { ok: true }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export function engineLabel(engine: Engine): string {
  return engine === 'claude'
    ? 'Claude Code'
    : engine === 'codex'
      ? 'Codex'
      : engine === 'openrouter'
        ? 'OpenRouter'
        : 'Cursor Agent'
}

// Prepended to OpenRouter (or-agent) task prompts. codex exec is a
// non-interactive one-shot, but weaker OR models don't realise it and end their
// turn with a clarifying question instead of doing the work. Say so plainly.
const OR_AUTONOMY_PREAMBLE = [
  'You are running FULLY AUTONOMOUSLY in a non-interactive one-shot process (codex exec).',
  'There is NO human reading your output and no follow-up turn — you cannot ask questions.',
  'Do NOT ask for confirmation, permission, or which part to start with, and do NOT end your',
  'turn with a question or a plan. Execute the ENTIRE task now: inspect the code, make all the',
  'edits, run the project checks, commit, and open the PR. Keep calling tools until the work is',
  'actually done. Only stop early if you are genuinely blocked — and then state the blocker explicitly.',
].join(' ')

function buildCmd(engine: Engine, worktree: string, prompt: string, model?: string): string {
  const bin = enginePath(engine)
  const modelFlag = model ? ` --model ${shq(model)}` : ''
  if (engine === 'claude') {
    return `${shq(bin)} -p ${shq(prompt)} --output-format stream-json --permission-mode auto${modelFlag}`
  }
  if (engine === 'cursor') {
    return `${shq(bin)} -p --force --trust --output-format stream-json --stream-partial-output --workspace ${shq(worktree)}${modelFlag} ${shq(prompt)}`
  }
  if (engine === 'openrouter') {
    // or-agent = Codex driven by an OpenRouter model. --model is the OR slug
    // (falls back to the registry agentic default when omitted). Reads
    // OPENROUTER_API_KEY from the spawn env (injected by the runner).
    // Weaker OR models tend to treat `codex exec` as a chat and stop to ask
    // "shall I proceed?" — a blunt non-interactive preamble keeps them working.
    return `${shq(bin)} --dir ${shq(worktree)}${modelFlag} ${shq(`${OR_AUTONOMY_PREAMBLE}\n\n${prompt}`)}`
  }
  return `${shq(bin)} exec -s danger-full-access -C ${shq(worktree)}${modelFlag} ${shq(prompt)}`
}

function displayCmd(engine: Engine, worktree: string, model?: string, scriptPath?: string | null): string {
  if (scriptPath) return `${scriptPath} # script-first agent`
  const bin = enginePath(engine)
  const modelFlag = model ? ` --model ${model}` : ''
  if (engine === 'claude') {
    return `${bin} -p <prompt> --output-format stream-json --permission-mode auto${modelFlag}`
  }
  if (engine === 'cursor') {
    return `${bin} -p --force --trust --output-format stream-json --stream-partial-output --workspace ${worktree}${modelFlag} <prompt>`
  }
  if (engine === 'openrouter') {
    return `${bin} --dir ${worktree}${modelFlag} <prompt>`
  }
  return `${bin} exec -s danger-full-access -C ${worktree}${modelFlag} <prompt>`
}

function classicAgentContextPrompt(agent: Agent): string {
  return `Run with the selected TerMinal classic agent context "${agent.title}" (${agent.id}).

Use this agent's operating guidance as the lens for the task below. Do not run a separate generic agent task; apply these instructions to the requested ticket, PR, or run.

Classic agent guidance:
${agent.prompt}`
}

function persistentAgentContextPrompt(repoRoot: string, id: string): { title: string; prompt: string } | null {
  const detail = getPersistentAgent(id)
  if (!detail) return null
  return {
    title: detail.title,
    prompt: `Run with the selected TerMinal persistent agent context "${detail.title}" (${detail.id}).

Persistent agent memory home:
${detail.dir}

Active workspace repo:
${repoRoot || '- Not provided.'}

Use the persistent agent files as memory and operating guidance for the task below:
- INSTRUCTIONS.md: stable operating instructions.
- MEMORY.md: durable memories and preferences.
- STATE.md: current state and open threads.
- JOURNAL.md: append-only run history.

Required workflow:
1. Read INSTRUCTIONS.md, MEMORY.md, STATE.md, and recent JOURNAL.md entries before acting.
2. Do the requested ticket, PR, or run task below.
3. Before ending, update STATE.md with current status and next actions.
4. Append a dated JOURNAL.md entry with what you did, decisions made, and files changed.
5. Update MEMORY.md only for durable facts or lessons that should affect future runs.`,
  }
}

function defaultQualityForAgent(agent: Agent): AgentQuality {
  const criteria = agent.acceptanceCriteria?.length
    ? agent.acceptanceCriteria
    : agent.quality?.acceptanceCriteria?.length
      ? agent.quality.acceptanceCriteria
    : [
        'Follow the repository agent process: assign ownership, gather knowledge before edits, and file owner-scoped follow-up tickets.',
        agent.opensPr ? 'Open and link a PR/MR when concrete changes are made.' : 'Write a durable summary of findings and tickets filed.',
        'End with checks run, artifacts produced, and follow-up ticket ids or none.',
      ]
  const deterministicChecks: AgentCheck[] = agent.quality?.deterministicChecks?.length
    ? agent.quality.deterministicChecks
    : agent.opensPr
      ? [
          {
            id: 'linked-pr',
            title: 'PR/MR is opened and linked when changes are made',
            command: 'git status --short && git log --oneline -1',
            cwd: 'worktree',
            required: false,
          },
        ]
      : []
  return {
    acceptanceCriteria: criteria,
    requiredArtifacts: agent.quality?.requiredArtifacts || [],
    deterministicChecks,
    judge: agent.quality?.judge || {
      enabled: false,
      mode: 'deterministic',
      rubric: [
        'Output matches the agent purpose.',
        'Findings cite concrete files, artifacts, or tickets.',
        'No out-of-scope changes were made.',
      ],
    },
  }
}

function defaultQualityForPersistentAgent(agent: ReturnType<typeof listPersistentAgents>[number]): AgentQuality {
  return {
    acceptanceCriteria: agent.quality?.acceptanceCriteria?.length ? agent.quality.acceptanceCriteria : [
      'Read INSTRUCTIONS.md, MEMORY.md, STATE.md, and recent JOURNAL.md entries before acting.',
      'Update STATE.md and append JOURNAL.md before ending.',
      'Write human-readable output under artifacts/<run>/ when the task produces a durable result.',
    ],
    requiredArtifacts: agent.quality?.requiredArtifacts || ['STATE.md', 'JOURNAL.md'],
    deterministicChecks: agent.quality?.deterministicChecks?.length ? agent.quality.deterministicChecks : [
      {
        id: 'memory-updated',
        title: 'Memory state files updated when work is performed',
        command: `test -f ${shq(join(agent.dir, 'STATE.md'))} && test -f ${shq(join(agent.dir, 'JOURNAL.md'))}`,
        cwd: 'repo',
        required: true,
      },
    ],
    judge: agent.quality?.judge || {
      enabled: false,
      mode: 'deterministic',
      rubric: [
        'Persistent memory was read and updated appropriately.',
        'Artifacts are concise and durable.',
        'Repo work follows the assigned ticket owner scope.',
      ],
    },
  }
}

function modelPolicyFrom(model?: string, policy?: AgentModelPolicy): AgentModelPolicy {
  return {
    default: policy?.default || model || undefined,
    cheap: policy?.cheap,
    deep: policy?.deep,
    judge: policy?.judge,
    allowOverride: policy?.allowOverride ?? true,
  }
}

export function listAgentDefinitions(repoRoot: string): AgentDefinition[] {
  const classic = readAgents(repoRoot).map((agent): AgentDefinition => {
    const scope = agent.source === 'repo' || agent.source === 'repo-override' ? 'repo' : 'global'
    const scriptPath = locateScript(repoRoot, agent.id) || undefined
    return {
      id: `classic:${scope}:${agent.id}`,
      ref: { id: agent.id, scope, kind: 'classic' },
      title: agent.title,
      description: agent.description,
      icon: agent.icon,
      scope,
      kind: 'classic',
      source: agent.source || 'default',
      runtime: {
        engine: agent.engine,
        model: agent.model,
        modelPolicy: modelPolicyFrom(agent.model, agent.modelPolicy),
        mode: scriptPath ? 'script' : 'prompt',
        scriptPath,
        inPlace: agent.inPlace,
        opensPr: agent.opensPr,
        force: agent.force,
      },
      instructions: {
        prompt: agent.prompt,
        knowledgePolicy: 'standard',
        outputContract: agent.outputContract,
      },
      quality: defaultQualityForAgent(agent),
      metadata: {},
    }
  })
  const persistent = listPersistentAgents().map((agent): AgentDefinition => ({
    id: `persistent:global:${agent.id}`,
    ref: { id: agent.id, scope: 'global', kind: 'persistent' },
    title: agent.title,
    description: agent.description,
    icon: 'Brain',
    scope: 'global',
    kind: 'persistent',
    source: 'persistent',
    runtime: {
      engine: agent.engine,
      model: agent.model,
      modelPolicy: modelPolicyFrom(agent.model, agent.modelPolicy),
      mode: 'persistent',
      memoryDir: agent.dir,
      inPlace: true,
      opensPr: false,
      force: false,
    },
    instructions: {
      knowledgePolicy: 'deep',
      outputContract: 'Update persistent memory files and write artifacts for durable outputs.',
    },
    quality: defaultQualityForPersistentAgent(agent),
    metadata: {
      tags: agent.tags,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      lastRunAt: agent.lastRunAt,
    },
  }))
  return [...classic, ...persistent].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'classic' ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}

export function resolveAgentDefinition(
  repoRoot: string,
  ref: { id: string; scope?: 'repo' | 'global'; kind?: 'classic' | 'persistent' },
): AgentDefinition | null {
  const defs = listAgentDefinitions(repoRoot)
  return (
    defs.find((d) => d.ref.id === ref.id && d.ref.kind === ref.kind && d.ref.scope === ref.scope) ||
    defs.find((d) => d.ref.id === ref.id && d.ref.kind === ref.kind) ||
    defs.find((d) => d.ref.id === ref.id) ||
    null
  )
}

function resolveRunContext(repoRoot: string, contextId?: string): { title?: string; prompt?: string } {
  if (!contextId) return {}
  if (contextId.startsWith('agent:')) {
    const id = contextId.slice('agent:'.length)
    const agent = readAgents(repoRoot).find((a) => a.id === id)
    return agent ? { title: agent.title, prompt: classicAgentContextPrompt(agent) } : {}
  }
  if (contextId.startsWith('persistent:')) {
    return persistentAgentContextPrompt(repoRoot, contextId.slice('persistent:'.length)) ?? {}
  }
  const p = getPersona(repoRoot, contextId)
  return p ? { title: p.title, prompt: p.prompt } : {}
}

function ticketAgentContextId(agent?: TicketAgent): string | undefined {
  if (!agent?.id) return undefined
  return agent.kind === 'persistent' ? `persistent:${agent.id}` : `agent:${agent.id}`
}

export function readAgentRunContexts(repoRoot: string): AgentRunContext[] {
  return listAgentDefinitions(repoRoot).map((agent) => ({
    id: agent.kind === 'persistent' ? `persistent:${agent.ref.id}` : `agent:${agent.ref.id}`,
    title: agent.title,
    description: `${agent.kind === 'persistent' ? 'Persistent' : 'Classic'} agent · ${agent.source}${agent.description ? ` · ${agent.description}` : ''}`,
    icon: agent.icon,
    prompt:
      agent.kind === 'persistent'
        ? persistentAgentContextPrompt(repoRoot, agent.ref.id)?.prompt ?? ''
        : classicAgentContextPrompt({
            id: agent.ref.id,
            title: agent.title,
            description: agent.description,
            icon: agent.icon,
            prompt: agent.instructions.prompt || '',
            opensPr: agent.runtime.opensPr,
            engine: agent.runtime.engine,
            model: agent.runtime.model,
            inPlace: agent.runtime.inPlace,
            force: agent.runtime.force,
            source: agent.source === 'persistent' ? 'global' : agent.source,
          }),
    agentId: agent.ref.id,
    agentScope: agent.ref.scope,
    agentKind: agent.ref.kind,
  }))
}

// Pipeline definitions + composition are pure (see ./pipelines, unit-tested).
// All stages share the worktree + branch, so a later stage sees what an earlier
// one committed. buildSteps just resolves the selected run context first.
function buildSteps(repoRoot: string, base: Step, personaId?: string, pipelineId?: string) {
  const context = resolveRunContext(repoRoot, personaId)
  return {
    steps: composeSteps(base, context.prompt ?? null, pipelineId),
    persona: context.title,
    pipeline: pipelineLabel(pipelineId),
  }
}

type RunSpec = {
  id: string
  title: string
  steps: Step[]
  engine: Engine
  persona?: string
  pipeline?: string
  /** PR-tab agents work ON an existing MR head instead of a fresh branch. */
  prRef?: { iid: number; sourceBranch: string }
  /** Run in the repo itself (no worktree) — for quick, additive ops like ticket filing. */
  inPlace?: boolean
  /** FORCE-MODE: spawn the child with TERMINAL_FORCE_MAIN=1 and prepend FORCE_PREAMBLE. */
  force?: boolean
  /** Optional per-engine model alias passed to the CLI as `--model <name>`. */
  model?: string
  quality?: AgentQuality
  trace?: AgentRunTrace
  rerun?: RerunSpec
}

function runSpec(repoRoot: string, spec: RunSpec): AgentRun | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  if (!spec.steps.length) return { error: 'no steps' }
  // Concurrent-run guard: never let two runs of the same agent on the same
  // repo overlap. If one is already running, surface HITL + refuse the new
  // run rather than silently allowing duplicates to thrash on the same worktree.
  for (const r of runs.values()) {
    if (r.status === 'running' && r.agentId === spec.id && r.repoRoot === repoRoot) {
      const msg = `${spec.title} is already running (run ${r.id.slice(0, 8)}) — refusing to start a duplicate`
      fileHitl({
        source: 'agent',
        title: `Duplicate agent run blocked · ${spec.title}`,
        action: 'another run is in progress; cancel it or wait for it to finish',
        detail: `existing run ${r.id} · started ${new Date(r.startedAt).toLocaleString()}`,
        repo: basename(repoRoot),
        repoRoot,
      })
      return { error: msg }
    }
  }
  const ts = Date.now()
  // ts + random tag → unique worktree path + branch even if two runs of the
  // same agent start in the same millisecond (parallel fan-out / fast clicks).
  const tag = `${ts}-${Math.random().toString(36).slice(2, 6)}`
  let worktree: string
  let branch: string
  const git = (args: string[]) =>
    execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (spec.inPlace) {
    // Run directly in the repo (no worktree) — e.g. quick ticket filing that must
    // land in the real backlog/, visible immediately, not on an isolated branch.
    worktree = repoRoot
    branch = '(working tree)'
  } else {
    worktree = join(resolvedWorktreesDir(), basename(repoRoot) || 'repo', `${spec.id}-${tag}`)
    try {
      if (spec.prRef) {
        // Fetch the MR head and check it out detached; the agent pushes back to
        // the source branch. Reference origin/<branch> rather than the shared
        // FETCH_HEAD so concurrent PR agents don't clobber each other.
        git(['fetch', 'origin', spec.prRef.sourceBranch])
        let ref = `origin/${spec.prRef.sourceBranch}`
        try {
          git(['rev-parse', '--verify', '--quiet', ref])
        } catch {
          ref = 'FETCH_HEAD' // remote-tracking ref not configured — best effort
        }
        git(['worktree', 'add', '--detach', worktree, ref])
        branch = spec.prRef.sourceBranch
      } else {
        branch = `agent/${spec.id}-${tag}`
        git(['worktree', 'add', worktree, '-b', branch, defaultBase(repoRoot)])
      }
    } catch (e) {
      return { error: `worktree: ${(e as Error).message}` }
    }
  }
  const repoLabel = repoForCwd(repoRoot)?.path || basename(repoRoot)
  const launchScriptPath = locateScript(repoRoot, spec.id)
  const launchModel = spec.model || engineDefaultModel(spec.engine) || ''
  const baseLine = spec.prRef
    ? `▸ on ${forgeFor(repoRoot).label} ${forgeFor(repoRoot).sym}${spec.prRef.iid} · branch ${branch}`
    : `▸ branch ${branch} (off ${defaultBase(repoRoot)})`
  const forceLine = spec.force ? '▸ ⚠ FORCE MODE — TERMINAL_FORCE_MAIN=1 (main-push allowed)\n' : ''
  const header =
    `▸ ${spec.title} · ${spec.engine}${spec.persona ? ` · as ${spec.persona}` : ''}` +
    `${spec.pipeline ? ` · ${spec.pipeline}` : ''}\n${baseLine}\n▸ worktree ${worktree}\n` +
    `▸ command ${displayCmd(spec.engine, worktree, launchModel || undefined, launchScriptPath)}\n${forceLine}\n`
  const run: AgentRun = {
    id: randomUUID(),
    agentId: spec.id,
    agentTitle: spec.title,
    engine: spec.engine,
    model: spec.model,
    persona: spec.persona,
    pipeline: spec.pipeline,
    rerun: spec.rerun,
    status: 'running',
    startedAt: ts,
    repoRoot,
    worktree,
    branch,
    output: header,
    force: spec.force,
    trace: spec.trace,
  }
  runs.set(run.id, run)
  persistMeta(run)
  appendLog(run.id, run.output)
  emit('agent:status', run)
  emitActivity(
    { kind: 'agent-run', title: `Agent started · ${spec.title}`, detail: `${spec.engine} · ${repoLabel}`, repo: repoLabel, repoRoot },
    { notify: false },
  )

  const append = (chunk: string) => {
    if (!chunk) return
    run.output += chunk
    if (run.output.length > OUTPUT_CAP) run.output = run.output.slice(-OUTPUT_CAP)
    appendLog(run.id, chunk)
    emit('agent:output', { runId: run.id, chunk })
  }

  let settled = false
  const finalize = (status: AgentRunStatus, exitCode?: number) => {
    if (settled) return
    settled = true
    run.status = status
    run.endedAt = Date.now()
    run.exitCode = exitCode
    // OpenRouter runs report their own cost via or-agent's final line
    // ("or-agent: done — cost $0.00548, exit 0"). Capture it for the Runs UI.
    if (spec.engine === 'openrouter') {
      const m = run.output.match(/or-agent: done[^$]*\$([0-9]+(?:\.[0-9]+)?)/)
      if (m) run.costUsd = Number(m[1])
    }
    run.evaluation = evaluateAgentRun(run, spec, status, append)
    procs.delete(run.id)
    persistMeta(run)
    if (spec.rerun?.kind === 'ticket') {
      try {
        const current = getLocalTicket(repoRoot, spec.rerun.slug)
        if (current?.run?.id === run.id) {
          updateLocalTicket(repoRoot, spec.rerun.slug, {
            run: { id: run.id, source: 'agent', status },
          })
        }
      } catch {
        /* ticket run-link status is observability-only */
      }
    }
    emit('agent:status', run)
    // Try to extract claude -p / codex exec usage from the captured output
    // and record an AIRun ledger entry. Best-effort — silent on miss.
    try {
      // Lazy-require to keep agents.ts decoupled from the observability layer.
      const { recordRunnerInvocation } = require('./ai-collectors') as typeof import('./ai-collectors')
      // cursor has no parseable usage; openrouter reports its own cost via
      // run.costUsd (or-agent), so it must NOT be mis-parsed as a claude-p run.
      if (spec.engine !== 'cursor' && spec.engine !== 'openrouter') {
        recordRunnerInvocation({
          source: spec.engine === 'codex' ? 'codex-exec' : 'claude-p',
          output: run.output,
          repoRoot,
          runId: run.id,
          agentId: spec.id,
          startedAt: run.startedAt,
          endedAt: run.endedAt!,
          exitCode: exitCode ?? -1,
          modelHint: spec.model || engineDefaultModel(spec.engine) || undefined,
        })
      }
    } catch {
      /* observability is non-critical; never block run completion */
    }
    emitActivity({
      // infra/run failures surface as 'error' (notify) so they don't hide in the
      // agent-run stream; normal completions stay 'agent-run'.
      kind: status === 'failed' || status === 'interrupted' ? 'error' : 'agent-run',
      title: `Agent ${status} · ${spec.title}`,
      detail: `${spec.engine} · ${branch}`,
      repo: repoLabel,
      repoRoot,
    })
  }

  let stepIdx = 0
  const runStep = () => {
    const step = spec.steps[stepIdx]
    if (spec.steps.length > 1) append(`\n━━ step ${stepIdx + 1}/${spec.steps.length} · ${step.label} ━━\n\n`)
    // Script-first: if .agents/<id>.sh (or global ~/.config/TerMinal/scripts/<id>.sh)
    // exists, exec it directly with env vars instead of building a prompt-based
    // command from the prompt. Inside the script the operator can mix
    // deterministic shell with `claude -p` / `codex exec` however they want.
    const scriptPath = launchScriptPath
    // Resolve model in priority order: explicit spec override > per-engine
    // Settings default > nothing (engine picks its own default). Same value
    // flows into both TERMINAL_MODEL (visible to scripts) and the buildCmd
    // fallback for prompt-style agents — so a script's `--model
    // "${TERMINAL_MODEL:-sonnet}"` pattern sees the user's Settings default.
    const effectiveModel = launchModel
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Inject TerMinal's bin dir so scripts can call `terminal-cli ...`.
      PATH: `${TERMINAL_BIN_DIR}:${process.env.PATH || ''}`,
      TERMINAL_REPO: repoRoot,
      TERMINAL_RUN_ID: run.id,
      TERMINAL_AGENT_ID: spec.id,
      TERMINAL_BRANCH: branch,
      TERMINAL_WORKTREE: worktree,
      TERMINAL_ENGINE: spec.engine,
      ...(effectiveModel ? { TERMINAL_MODEL: effectiveModel } : {}),
      // OpenRouter (or-agent) reads this; sealed Setting first, else inherited env.
      ...(resolvedOpenRouterKey() ? { OPENROUTER_API_KEY: resolvedOpenRouterKey() } : {}),
      // FORCE-MODE: passes the block-main-merge hook's env-var carve-out.
      // Only set when the agent has `force: true`; never inherited from the
      // parent process (a normal launch of TerMinal never has this var set).
      ...(spec.force ? { TERMINAL_FORCE_MAIN: '1' } : {}),
    }
    // Don't leak an inherited Claude Code session identity into spawned agents —
    // it marks them as nested child sessions. See the same strip in
    // src/main/index.ts (interactive spawn) for the full rationale.
    for (const k of Object.keys(env)) {
      if (k.startsWith('CLAUDE_CODE_')) delete env[k]
    }
    delete env.CLAUDECODE
    // For prompt-style (non-script) FORCE agents, prepend the preamble so the
    // spawned model knows it has main-push authority; script-first agents read
    // the env var directly.
    const contextEnabled = readSettings().inbox.agentContextPreamble
    const contextPrompt = scriptPath ? step.prompt : withAgentContextPreamble(repoRoot, step.prompt, contextEnabled)
    const promptForStep = spec.force && !scriptPath ? FORCE_PREAMBLE + contextPrompt : contextPrompt
    const cmd = scriptPath
      ? shq(scriptPath)
      : buildCmd(spec.engine, worktree, promptForStep, effectiveModel || undefined)
    // Wrap the spawn in `script -q /dev/null` so engines think they're on
    // a TTY and stream output as it's generated. Without this, `claude -p`
    // buffers everything until exit and the run log shows nothing mid-run
    // (the same fix shipped to bin/terminal-cron). Pipes still carry the
    // streamed bytes back to Node for live render via agents:output IPC.
    const p = spawn('script', ['-q', '/dev/null', LOGIN_SHELL, '-l', '-c', cmd], {
      cwd: worktree,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    procs.set(run.id, p)
    const streamDecoder = createAgentStreamDecoder(spec.engine, !scriptPath)
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    p.stdout?.on('data', (d: Buffer) => append(streamDecoder.write(stdoutDecoder.write(d))))
    p.stderr?.on('data', (d: Buffer) => append(stderrDecoder.write(d)))
    p.on('error', (err) => {
      append(`\n[spawn error] ${err.message}\n`)
      finalize('failed')
    })
    p.on('exit', (code) => {
      const stdoutTail = stdoutDecoder.end()
      const stderrTail = stderrDecoder.end()
      if (stdoutTail) append(streamDecoder.write(stdoutTail))
      append(streamDecoder.end())
      if (stderrTail) append(stderrTail)
      if (run.status === 'canceled') return finalize('canceled', code ?? undefined)
      if (code !== 0) return finalize('failed', code ?? undefined)
      stepIdx++
      if (stepIdx < spec.steps.length) runStep()
      else finalize('done', 0)
    })
  }
  runStep()
  return run
}

export function runAgent(
  repoRoot: string,
  agentId: string,
  engine?: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
): AgentRun | { error: string } {
  const agent = readAgents(repoRoot).find((a) => a.id === agentId)
  if (!agent) return { error: 'unknown agent' }
  const resolvedEngine = engine || agent.engine || 'codex'
  const resolvedModel = model ?? agent.model
  const provider = repoTicketProvider(repoRoot)
  const ticketContext =
    provider.kind === 'local'
      ? ''
      : `${ticketProviderInstructions(provider)} If this task does not involve filing or updating tickets, ignore this ticketing note.\n\n`
  const { steps, persona, pipeline } = buildSteps(
    repoRoot,
    { label: agent.title, prompt: `${ticketContext}${agent.prompt}` },
    personaId,
    pipelineId,
  )
  return runSpec(repoRoot, {
    id: agent.id,
    title: agent.title,
    steps,
    engine: resolvedEngine,
    persona,
    pipeline,
    inPlace: agent.inPlace,
    force: agent.force,
    model: resolvedModel,
    quality: agent.quality || {
      acceptanceCriteria: agent.acceptanceCriteria,
      requiredArtifacts: agent.outputContract ? [agent.outputContract] : undefined,
    },
    rerun: { kind: 'agent', agentId: agent.id, engine: resolvedEngine, personaId, pipelineId, model: resolvedModel },
  })
}

/** Spawn an agent run that designs a new agent from a natural-language
 *  description and saves it into the active scope (the active repo's
 *  .agents/agents.json, or the global registry). Runs inPlace — no fresh
 *  worktree, no PR — because designing an agent is a quick read+write op. */
export function runDesignerSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
  scope: 'repo' | 'global',
  model?: string,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  const targetDir =
    scope === 'global'
      ? join(homedir(), '.config', 'TerMinal', 'scripts')
      : join(repoRoot, '.agents')
  const scopeLabel =
    scope === 'global'
      ? "TerMinal's GLOBAL script registry (~/.config/TerMinal/scripts/)"
      : `this repo's .agents/ directory`
  const prompt = `You are designing a new TerMinal agent as an EXECUTABLE BASH SCRIPT plus a small sidecar metadata JSON, per the scripts unification (see .agents/scripts.md).

Target: ${scopeLabel}
Two files to write (mkdir -p the parent dir if needed):
  ${targetDir}/<id>.sh    # the executable body — chmod 755 after writing
  ${targetDir}/<id>.json  # sidecar metadata, validated by TerMinal

Pick a kebab-case <id> from the user's description.

The sidecar JSON shape (every field optional except id + title):
  {
    "id":          "kebab-case",
    "title":       "short user-facing label (e.g. 'Audit security')",
    "description": "one-line summary",
    "icon":        "lucide-react icon name — Bot, BookText, ScanSearch, ListChecks, TestTube2, ShieldAlert, Gauge, PackageCheck, Eraser, Wrench, Activity, Zap, etc.",
    "opensPr":     true | false,
    "engine":      "claude" | "codex" | "cursor"  (hint; runtime can override),
    "model":       "haiku" | "sonnet" | "opus" | "gpt-5" | "gpt-5-codex" | "o4-mini" | "composer-2.5-fast" | "composer-2.5"  (hint; optional),
    "inPlace":     true | false  (true ONLY if the agent manages worktrees itself — rare)
  }

The script body MUST follow this shape:
  - First line: #!/usr/bin/env bash
  - Use 'set -uo pipefail' (NOT -e — you want to inspect exit codes).
  - Read these env vars the runner provides:
      TERMINAL_REPO      — the repo root
      TERMINAL_RUN_ID    — uuid of this run
      TERMINAL_AGENT_ID  — id of this agent (used as the state key)
      TERMINAL_BRANCH    — worktree branch (or "main" if inPlace)
      TERMINAL_WORKTREE  — worktree path (== TERMINAL_REPO if inPlace)
      TERMINAL_ENGINE    — hint from sidecar / schedule override (default fallback when calling an agent engine)
      TERMINAL_MODEL     — hint from sidecar / schedule override
  - For LLM calls inside the script:
      claude -p "<prompt>" --permission-mode auto --model "\${TERMINAL_MODEL:-sonnet}"
      codex exec -s danger-full-access -C "\${TERMINAL_WORKTREE}" --model "\${TERMINAL_MODEL:-gpt-5}" "<prompt>"
      cursor-agent -p --force --trust --workspace "\${TERMINAL_WORKTREE}" --model "\${TERMINAL_MODEL:-composer-2.5-fast}" "<prompt>"
  - For TerMinal helpers, use these (on PATH via ~/.config/TerMinal/bin/terminal-cli):
      terminal-cli ticket "<title>" "<body>"   # file a backlog ticket on TERMINAL_REPO
      terminal-cli hitl "<title>" "<action>"   # file a global HITL item + Telegram ping
      terminal-cli activity <kind> "<title>" "<detail>"   # emit one activity-feed event
      terminal-cli notify "<message>"          # raw Telegram message
      terminal-cli state get-sha               # last main/master sha this agent scanned ("" if first run)
      terminal-cli state mark-main             # fetch + record origin/main tip as lastScannedSha
      terminal-cli state get|set <key> [value] # arbitrary per-(repo, agent) key/value persistence
  - INCREMENTAL-SCAN PATTERN (use when the agent re-runs on a cadence and only cares about new commits):
      last=\\$(terminal-cli state get-sha)
      range="\${last:-HEAD~50}..HEAD"
      changes=\\$(git -C "\$TERMINAL_REPO" log --oneline "\$range" -- src/)
      [ -z "\$changes" ] && { echo "no new commits"; exit 0; }
      ... do the work ...
      terminal-cli state mark-main     # record where we scanned through

THE BODY MUST FOLLOW THE PROJECT'S WORKFLOW:
  - The ticket + MR workflow uniformly. The MERGE TO MAIN IS HUMAN-ONLY — never \`gh pr merge\` / \`--auto\` / \`--merge\`.
  - File backlog tickets via \`terminal-cli ticket\` for findings the script cannot fix in-pass.
  - Open a PR only when there are concrete changes. If the diff is ONLY docs/markdown/tickets/reports, apply the \`auto-mergeable\` label per .agents/forge.md.
  - Explicit success criteria (what makes the run "done"). \`exit 0\` on success; non-zero on failure.
  - HITL only for true blockers (decisions, credentials, hard blockers) via \`terminal-cli hitl\`.

CONVENTIONS TO READ BEFORE WRITING THE SCRIPT:
  1. CLAUDE.md (root) — project conventions and global rules.
  2. .agents/scripts.md — the design + helper reference.
  3. .agents/forge.md — auto-mergeable label + forge command mapping.
  4. Existing example: .agents/health.sh — the cheap-precheck-then-LLM pattern.
  5. backlog/EXAMPLE.md or .claude/skills/ticket/EXAMPLE.md — ticket schema (incl. depends_on).
  6. Existing scripts in the target dir — don't duplicate ids; pick a distinct kebab-case id.

User's description:
> ${t}

PROCESS:
  1. Read the conventions above (enough to write a faithful script).
  2. Pick the kebab-case id + title + icon + opensPr based on the description.
  3. Decide whether this agent benefits from a deterministic precheck (a "cheap-then-escalate" pattern saves tokens). If yes, write the precheck FIRST in the script.
  4. Author the bash body. Keep it small + readable; prefer terminal-cli over hand-rolled JSON manipulation.
  5. Write \`${targetDir}/<id>.sh\` with the script body. \`chmod 755\` it.
  6. Write \`${targetDir}/<id>.json\` with the sidecar metadata.
  7. Confirm by printing the absolute paths of both files and the sidecar JSON contents.

DO NOT open a PR, do not modify any existing agents, do not invent extra files.`
  return runSpec(repoRoot, {
    id: `design-${scope}`,
    title: `Design agent · ${t.slice(0, 48)}`,
    steps: [{ label: 'design agent', prompt }],
    engine,
    inPlace: true,
    model,
    rerun: { kind: 'agent-designer', text: t, engine, scope, model },
  })
}

export { saveGlobalAgent }

/** Spawn an in-place run for a global persistent memory agent. The memory
 *  directory is global, but the engine runs from the active repo so repo
 *  commands, diffs, tests, and relative paths behave like the user's current
 *  workspace. */
export function runPersistentAgent(
  repoRoot: string,
  persistentAgentId: string,
  task: string,
  engine?: Engine,
  model?: string,
): AgentRun | { error: string } {
  const prepared = persistentAgentLaunchPrompt(persistentAgentId, task, { repoRoot, engine, model })
  if ('error' in prepared) return prepared
  const resolvedEngine = engine || prepared.agent.engine
  const resolvedModel = model ?? prepared.agent.model
  return runSpec(repoRoot, {
    id: `persistent-${prepared.agent.id}`,
    title: `Persistent · ${prepared.agent.title}`,
    steps: [{ label: 'persistent agent', prompt: prepared.prompt }],
    engine: resolvedEngine,
    model: resolvedModel,
    inPlace: true,
    quality: prepared.agent.quality,
    rerun: {
      kind: 'persistent-agent',
      persistentAgentId: prepared.agent.id,
      task,
      engine: resolvedEngine,
      model: resolvedModel,
    },
  })
}

/** Spawn an in-place designer that creates a global persistent memory agent
 *  under ~/.config/TerMinal/persistent-agents. */
export function runPersistentAgentDesignerSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
  model?: string,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  return runSpec(repoRoot, {
    id: 'persistent-agent-designer',
    title: `Design persistent agent · ${t.slice(0, 48)}`,
    steps: [{ label: 'design persistent agent', prompt: persistentAgentDesignerPrompt(t, engine, model) }],
    engine,
    model,
    inPlace: true,
    rerun: { kind: 'persistent-agent-designer', text: t, engine, model },
  })
}

/** Spawn an agent run that designs a new schedule entry from a natural-
 *  language description. Reads the active agent list + existing schedules,
 *  appends a new entry to ~/.config/TerMinal/schedules.json. After the run
 *  completes the renderer reconciles + relaunches the LaunchAgent. */
export function runScheduleDesignerSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  const schedulesFile = join(homedir(), '.config', 'TerMinal', 'schedules.json')
  const agents = readAgents(repoRoot)
  const agentSummary = agents.length
    ? agents
        .map(
          (a) =>
            `  - id: ${a.id} · title: ${a.title}${a.description ? ` · ${a.description}` : ''} · default-engine: ${a.engine || 'claude'} · opensPr: ${!!a.opensPr}`,
        )
        .join('\n')
    : '  (none — the user should create an agent first via the Agents tab)'
  const prompt = `You are designing a new TerMinal scheduled run based on the user's natural-language description.

Available agents (use one of these IDS verbatim — do NOT invent a new one):

${agentSummary}

Target file: ${schedulesFile}
  - If it does not exist, treat as an empty JSON array.
  - If it exists, parse the JSON array, append the new entry, write back with 2-space indent.

Schedule entry schema:
{
  "id": "<uuid v4>",
  "repoRoot": "${repoRoot}",
  "repoLabel": "<basename of repoRoot, or the GitHub/GitLab owner/repo if obvious>",
  "agentId": "<one of the ids above>",
  "agentTitle": "<the matching agent's title>",
  "engine": "claude" | "codex",
  "prompt": "<copy the matching agent's prompt verbatim>",
  "spec": <a ScheduleSpec — see below>,
  "enabled": true,
  "createdAt": <epoch ms — use \`date +%s%3N\` or current ms>,
  "lastStatus": "never"
}

ScheduleSpec options:
  { "kind": "interval", "everyMinutes": <number> }                              # every N minutes
  { "kind": "calendar", "minute": 0, "hour": 9 }                                # every day at 9:00
  { "kind": "calendar", "minute": 30, "hour": 14, "weekdays": [1,3,5] }         # Mon/Wed/Fri 2:30pm
  { "kind": "cron",     "expr": "30 9 * * 1-5" }                                # raw 5-field cron

User's description:
> ${t}

PROCESS:
  1. Parse the user's description to extract (a) which agent and (b) the cadence.
  2. Match the agent by id from the list above. If no clear match, pick the closest reasonable one and NOTE that in your final summary so the user can adjust.
  3. Generate a UUID v4 (uuidgen on macOS, or a /dev/urandom hex if not).
  4. Read the existing ${schedulesFile} JSON array (or start with []).
  5. Append the new entry. Write back with 2-space indent.
  6. Print the new entry as JSON so the user can verify; mention the inferred cadence + agent in plain English ("Every Monday at 9am, run docs.").

DO NOT open a PR. DO NOT modify the repo. Only write to ${schedulesFile}.

After this completes the app reconciles schedules automatically — your new entry becomes a real LaunchAgent the next time it loads.`
  return runSpec(repoRoot, {
    id: 'design-schedule',
    title: `Design schedule · ${t.slice(0, 48)}`,
    steps: [{ label: 'design schedule', prompt }],
    engine,
    inPlace: true,
    rerun: { kind: 'schedule-designer', text: t, engine },
  })
}

/** Turn a backlog ticket into an implementation run that opens a PR. */
/** Hard ceiling on parallel lanes — fan-out spawns one engine process each. */
export const MAX_LANES = 100

type TicketRunInput = { slug?: string; id: number; title: string; body: string; externalKey?: string; url?: string; agent?: TicketAgent }

export function runTicketAgent(
  repoRoot: string,
  ticket: TicketRunInput,
  engine: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
  lane?: { group: string; index: number; total: number },
): AgentRun | { error: string } {
  const provider = repoTicketProvider(repoRoot)
  const ref = ticket.externalKey || `#${ticket.id}`
  // Lanes are independent variant attempts: each opens its OWN MR and must NOT
  // touch the ticket (concurrent frontmatter writes would race). The judge step
  // compares lanes and links the winner. A solo run links the ticket as before.
  const ticketWriteInstr = lane
    ? `Open a PR/MR that references ticket ${ref}${ticket.url ? ` (${ticket.url})` : ''} and report its URL. Do NOT modify the ticket file, its status, or its prs — a separate judging step compares all lanes and links the winner.`
    : `Commit your work and open a PR that references ticket ${ref}${ticket.url ? ` (${ticket.url})` : ''}. If fully delivered set the ticket status to closed (else in-progress). Link or reference the PR in the ticket provider when supported.`
  const laneFraming = lane
    ? `\n\n--- LANE ${lane.index} of ${lane.total} ---\nYou are one of ${lane.total} independent variant attempts at this ticket, each in its own worktree and branch. Pursue a genuinely distinct, high-quality approach — don't converge on the obvious one. Satisfy every acceptance criterion in the ticket.`
    : ''
  const base = `Implement ticket ${ref}: ${ticket.title}\n\n${ticket.body}\n\n${ticketProviderInstructions(provider)}${laneFraming}\n\nWork in this worktree on its branch. Implement the ticket end to end — keep changes surgical and add/adjust tests. ${ticketWriteInstr} End with a short summary of what changed and the PR URL.`
  const resolvedPersonaId = personaId || ticketAgentContextId(ticket.agent)
  const { steps, persona, pipeline } = buildSteps(repoRoot, { label: `implement ${ref}`, prompt: base }, resolvedPersonaId, pipelineId)
  const ownerQuality = ticket.agent?.kind === 'classic' ? readAgents(repoRoot).find((a) => a.id === ticket.agent?.id)?.quality : undefined
  return runSpec(repoRoot, {
    id: lane ? `ticket-${ticket.id}-L${lane.index}` : `ticket-${ticket.id}`,
    title: lane ? `Implement ${ref} · lane ${lane.index}/${lane.total}` : `Implement ${ref}`,
    steps,
    engine,
    persona,
    pipeline,
    model,
    quality: ownerQuality,
    trace: { ticketSlug: ticket.slug, ticketId: ticket.id, ticketRef: ref, lane },
    // Lanes aren't individually rerunnable as the ticket (that would relaunch
    // the whole group); only solo runs carry a ticket rerun spec.
    rerun: ticket.slug && !lane ? { kind: 'ticket', slug: ticket.slug, engine, personaId: resolvedPersonaId, pipelineId, model } : undefined,
  })
}

export type LaneFanout = { group: string | null; runs: AgentRun[]; errors?: string[] }

/** Launch `lanes` parallel variant attempts of a ticket, each in its own
 *  worktree/branch with its own MR. lanes<=1 is the classic single run. */
export function runTicketLanes(
  repoRoot: string,
  ticket: TicketRunInput,
  engine: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
  lanes?: number,
): LaneFanout | { error: string } {
  const n = Math.max(1, Math.min(MAX_LANES, Math.floor(lanes || 1)))
  if (n <= 1) {
    const r = runTicketAgent(repoRoot, ticket, engine, personaId, pipelineId, model)
    return 'error' in r ? r : { group: null, runs: [r] }
  }
  const group = `lane-${ticket.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  const runs: AgentRun[] = []
  const errors: string[] = []
  for (let k = 1; k <= n; k++) {
    const r = runTicketAgent(repoRoot, ticket, engine, personaId, pipelineId, model, { group, index: k, total: n })
    if ('error' in r) errors.push(`lane ${k}: ${r.error}`)
    else runs.push(r)
  }
  if (!runs.length) return { error: errors.join('; ') || 'no lanes started' }
  return { group, runs, errors: errors.length ? errors : undefined }
}

/** Spawn an agent that files ONE backlog ticket from a freeform request. Runs
 *  in-place (no worktree) so the ticket lands in the active backlog immediately. */
export function runTicketSpawn(
  repoRoot: string,
  text: string,
  engine: Engine,
  model?: string,
): AgentRun | { error: string } {
  const t = text.trim()
  if (!t) return { error: 'empty request' }
  const provider = repoTicketProvider(repoRoot)
  const prompt =
    provider.kind === 'github'
      ? `File exactly ONE new GitHub Issue for the request below using the gh CLI in this repository. Set useful labels for type/priority/status when labels exist or can be safely created. Do NOT implement anything or open a PR.\n\nRequest: ${t}`
      : provider.kind === 'linear'
        ? `File exactly ONE new Linear issue for the request below using the configured Linear MCP/CLI. Use the repo/provider conventions for team, status, and priority. Do NOT implement anything or open a PR.\n\nRequest: ${t}`
        : `File exactly ONE new backlog ticket for the request below, using this project's ticket conventions: allocate the next id (use .claude/skills/ticket/bin/next-ticket-id if present, else the next NNNN above the highest active backlog ticket), write .TerMinal/backlog/NNNN-slug.md with valid YAML frontmatter (id, title, status: open, priority, type, horizon: now) matching the ticket example (legacy v1 repos may use backlog/), put any detail in the body after the closing ---, and commit it. Do NOT implement anything or open a PR — just file the ticket. Request: ${t}`
  return runSpec(repoRoot, {
    id: 'ticket-spawn',
    title: `File ticket · ${t.slice(0, 48)}`,
    steps: [{ label: 'file ticket', prompt }],
    engine,
    inPlace: true,
    model,
    rerun: { kind: 'ticket-spawn', text: t, engine, model },
  })
}

/** Start the /factory orchestrator as an in-place run — drives the backlog to
 *  merge-ready PRs (stacked-mr passes, gated by review), never merging to main. */
export function runFactorySpawn(repoRoot: string, engine: Engine): AgentRun | { error: string } {
  if (!repoRoot) return { error: 'not a git repo' }
  const prompt = `Run the /factory orchestrator for THIS repository, following the project's /factory skill exactly. This is a no-handoff loop: continuously turn the backlog into REVIEWED, merge-ready PRs by reconciling with /merge-sync, running /stacked-mr passes (build a stack TDD-first → batch-review to the bar → handle verdicts), compacting/migrating context at phase boundaries, then continuing with any runnable independent lane. NEVER stop with "tell me when you're ready" language. Stop only if the user explicitly stops you, the goal is actually complete, or every remaining lane is blocked on human-only action. NEVER merge to main/master — the human merges. Park any TRUE human-need (decision, approval, creds, hard blocker) to the global HITL inbox with .claude/bin/hitl, then continue other work. Emit an activity event at each checkpoint. Do not invent scope. End only when the factory loop has no runnable work left.`
  return runSpec(repoRoot, {
    id: 'factory',
    title: 'Factory',
    steps: [{ label: 'factory loop', prompt }],
    engine,
    inPlace: true,
    rerun: { kind: 'factory', engine },
  })
}

export type PrAgentKind = 'review' | 'iterate'

/** Spin an agent out ON an open MR: checks out the MR head, reviews/iterates,
 *  and pushes back to the source branch to update it. */
export function runPrAgent(
  repoRoot: string,
  pr: { iid: number; sourceBranch: string; title?: string; webUrl?: string },
  kind: PrAgentKind,
  engine: Engine,
  personaId?: string,
  pipelineId?: string,
  model?: string,
): AgentRun | { error: string } {
  if (!pr?.sourceBranch) return { error: 'PR/MR has no source branch' }
  const f = forgeFor(repoRoot)
  const tag = `${f.label} ${f.sym}${pr.iid}` // e.g. "PR #12" / "MR !12"
  const noteCmd =
    f.kind === 'github' ? `gh pr comment ${pr.iid} -b …` : `glab mr note ${pr.iid} -m …`
  const ref = pr.webUrl || `${f.sym}${pr.iid}`
  const reviewCtx = `This worktree is checked out at the head of ${tag} (${ref}${pr.title ? ` — "${pr.title}"` : ''}) on branch "${pr.sourceBranch}".`
  const iterateCtx = `${reviewCtx} After committing, push back to the ${f.label} with \`git push origin HEAD:${pr.sourceBranch}\`.`
  const resolvedPersonaId = kind === 'review' ? personaId || 'agent:code-review' : personaId
  const base: Step =
    kind === 'review'
      ? {
          label: `review ${f.sym}${pr.iid}`,
          prompt: `Review ${tag} using the selected code-review agent contract. ${reviewCtx} Resolve the target branch and current head commit, inspect the diff and relevant history, run the project test gate, and write the review artifacts required by the agent definition or in-repo .agents/code-review.md contract. Post or summarize the verdict for the ${f.label} when the repo workflow expects it (${noteCmd}). Do not implement fixes during review; file owner-scoped follow-up tickets for out-of-scope work. End with verdict, artifact path, test status, and key findings.`,
        }
      : {
          label: `iterate ${f.sym}${pr.iid}`,
          prompt: `Iterate on ${tag} until it is merge-ready. ${iterateCtx} Address open review findings and TODOs, make the test suite and build pass, and tighten edge cases — keep changes surgical. Commit and push your work. End with the final status (tests/build green?) and a short summary of what changed.`,
        }
  const { steps, persona, pipeline } = buildSteps(repoRoot, base, resolvedPersonaId, pipelineId)
  return runSpec(repoRoot, {
    id: `pr-${kind}-${pr.iid}`,
    title: `${kind === 'review' ? 'Review' : 'Iterate'} ${f.sym}${pr.iid}`,
    steps,
    engine,
    persona,
    pipeline,
    prRef: { iid: pr.iid, sourceBranch: pr.sourceBranch },
    model,
    quality: kind === 'review' ? readAgents(repoRoot).find((a) => a.id === 'code-review')?.quality : undefined,
    trace: { prIid: pr.iid, prKind: kind, sourceBranch: pr.sourceBranch },
    rerun: { kind: 'pr', pr, prKind: kind, engine, personaId: resolvedPersonaId, pipelineId, model },
  })
}

export async function rerunAgentRun(runId: string): Promise<AgentRun | { error: string }> {
  loadPersistedRuns()
  const run = runs.get(runId)
  if (!run) return { error: 'run not found' }
  if (run.status === 'running') return { error: 'run is already running' }
  const spec = run.rerun
  if (!spec) {
    const engine =
      run.engine === 'claude' || run.engine === 'codex' || run.engine === 'cursor' || run.engine === 'openrouter'
        ? run.engine
        : undefined
    return runAgent(run.repoRoot, run.agentId, engine, undefined, undefined, run.model)
  }
  if (spec.kind === 'agent') return runAgent(run.repoRoot, spec.agentId, spec.engine, spec.personaId, spec.pipelineId, spec.model)
  if (spec.kind === 'ticket') {
    const t = await getRepoTicket(run.repoRoot, spec.slug)
    return t
      ? runTicketAgent(run.repoRoot, { slug: t.slug, id: t.id, title: t.title, body: t.body, externalKey: t.externalKey, url: t.url, agent: t.agent }, spec.engine, spec.personaId, spec.pipelineId, spec.model)
      : { error: 'ticket not found' }
  }
  if (spec.kind === 'pr') return runPrAgent(run.repoRoot, spec.pr, spec.prKind, spec.engine, spec.personaId, spec.pipelineId, spec.model)
  if (spec.kind === 'ticket-spawn') return runTicketSpawn(run.repoRoot, spec.text, spec.engine, spec.model)
  if (spec.kind === 'factory') return runFactorySpawn(run.repoRoot, spec.engine)
  if (spec.kind === 'agent-designer') return runDesignerSpawn(run.repoRoot, spec.text, spec.engine, spec.scope, spec.model)
  if (spec.kind === 'persistent-agent') {
    return runPersistentAgent(run.repoRoot, spec.persistentAgentId, spec.task, spec.engine, spec.model)
  }
  if (spec.kind === 'persistent-agent-designer') {
    return runPersistentAgentDesignerSpawn(run.repoRoot, spec.text, spec.engine, spec.model)
  }
  if (spec.kind === 'schedule-designer') return runScheduleDesignerSpawn(run.repoRoot, spec.text, spec.engine)
  return { error: 'unsupported run type' }
}

export function cancelRun(runId: string): boolean {
  const run = runs.get(runId)
  const p = procs.get(runId)
  if (run && run.status === 'running') {
    run.status = 'canceled'
    persistMeta(run)
  }
  p?.kill('SIGTERM')
  return !!p
}

/** Remove a finished run's worktree (the branch/commits/PR remain). */
export function removeWorktree(runId: string): boolean {
  const run = runs.get(runId)
  if (!run || run.status === 'running') return false
  if (run.worktree === run.repoRoot) return false // in-place run — never remove the repo
  try {
    execFileSync('git', ['-C', run.repoRoot, 'worktree', 'remove', run.worktree, '--force'], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}
