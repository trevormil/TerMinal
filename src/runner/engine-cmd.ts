// Engine → shell command, and the env the wrapped CLI runs under. Pure enough
// to test directly: everything it reads from disk arrives through the settings
// helpers, which resolve against TERMINAL_CONFIG_DIR.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Schedule } from '../shared/types/schedules'
import { CFG, TERMINAL_BIN_DIR } from './config'
import { shq } from './git'
import { repoStateEnv } from './repo-state'
import { effortFlag, engineDefaultModel, openAICompatBaseUrl, resolveEffort } from './settings'

// Autonomy preamble for the OpenRouter/Hermes harnesses — keeps weaker models
// from stopping to ask in a non-interactive one-shot. Mirrors OR_AUTONOMY_PREAMBLE
// in src/main/agents.ts (keep in sync by hand).
export const OR_PREAMBLE =
  'You are running FULLY AUTONOMOUSLY in a non-interactive one-shot process. ' +
  'There is NO human reading your output and no follow-up turn — you cannot ask questions. ' +
  'Do NOT ask for confirmation, permission, or which part to start with, and do NOT end your ' +
  'turn with a question or a plan. Execute the ENTIRE task now: inspect the code, make all the ' +
  'edits, run the project checks, commit, and open the PR. Keep calling tools until the work is ' +
  'actually done. Only stop early if you are genuinely blocked — and then state the blocker explicitly.'

// Script-first: if .agents/<id>.sh (or a global script) exists, exec it
// directly with env vars instead of building a prompt-based command from
// the schedule's prompt snapshot. The script body decides whether to call
// claude -p / codex exec / pure shell — perfect for cheap-then-escalate
// pipelines that only pay for an LLM when a precheck fails.
export function resolveScriptPath(repo: string, agentId: string): string | null {
  const perRepoScript = join(repo, '.agents', `${agentId}.sh`)
  const globalScript = join(CFG(), 'scripts', `${agentId}.sh`)
  return existsSync(perRepoScript) ? perRepoScript : existsSync(globalScript) ? globalScript : null
}

// Engine → command. openrouter/hermes were previously missing here and fell
// through to codex (a silent wrong-engine bug); they now build their real
// commands (or-agent is bundled on the runner's PATH; hermes must be present).
// openai-compat = or-agent retargeted by OPENAI_BASE_URL (injected into the
// child env below from settings.json); guard here so an unset base URL fails
// loudly instead of or-agent silently falling back to OpenRouter.
export function buildCommand(sched: Schedule, worktree: string, scriptPath: string | null): string {
  // Optional per-schedule model alias. Lets a lightweight schedule avoid burning the
  // biggest model on every run.
  const modelFlag = sched.model ? ` --model ${shq(sched.model)}` : ''
  const hermesModel = sched.model ? ` -m ${shq(sched.model)}` : ''
  const hermesUsage = join(worktree, '.terminal-hermes-usage.json')
  const effFlag = effortFlag(sched)
  return scriptPath
    ? shq(scriptPath)
    : sched.engine === 'claude'
      ? `claude -p ${shq(sched.prompt)} --permission-mode auto${modelFlag}${effFlag}`
      : sched.engine === 'cursor'
        ? `cursor-agent -p --force --trust --output-format text --workspace ${shq(worktree)}${modelFlag} ${shq(sched.prompt)}`
        : sched.engine === 'openrouter'
          ? `or-agent --dir ${shq(worktree)}${modelFlag}${effFlag} ${shq(`${OR_PREAMBLE}\n\n${sched.prompt}`)}`
          : sched.engine === 'openai-compat'
            ? `[ -n "$OPENAI_BASE_URL" ] || { echo "openai-compat: no base URL configured (TerMinal Settings → Engines → Self-hosted)"; exit 2; }; or-agent --dir ${shq(worktree)}${modelFlag}${effFlag} ${shq(`${OR_PREAMBLE}\n\n${sched.prompt}`)}`
            : sched.engine === 'hermes'
              ? `hermes -z ${shq(`${OR_PREAMBLE}\n\n${sched.prompt}`)}${hermesModel} --usage-file ${shq(hermesUsage)} --yolo --accept-hooks`
              : `codex exec -s danger-full-access -C ${shq(worktree)}${modelFlag}${effFlag} ${shq(sched.prompt)}`
}

export type ChildEnvInput = {
  sched: Schedule
  repo: string
  runId: string
  branch: string
  worktree: string
}

// Env vars exposed to the script body — scripts can `terminal-cli ticket ...`
// etc. since the runner installs terminal-cli into ~/.config/TerMinal/bin.
export function buildChildEnv({
  sched,
  repo,
  runId,
  branch,
  worktree,
}: ChildEnvInput): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: `${TERMINAL_BIN_DIR()}:${process.env.PATH || ''}`,
    TERMINAL_REPO: repo,
    // Workflow state lives in a per-project sidecar and .agents/*.sh reference
    // TERMINAL_<AREA>_DIR rather than literal paths — a scheduled run without
    // these resolves empty and writes somewhere arbitrary. Absolute paths:
    // never prefix them with TERMINAL_REPO.
    ...repoStateEnv(repo),
    TERMINAL_RUN_ID: runId,
    TERMINAL_AGENT_ID: sched.agentId,
    TERMINAL_BRANCH: branch,
    TERMINAL_WORKTREE: worktree,
    TERMINAL_ENGINE: sched.engine,
    ...(sched.model || engineDefaultModel(sched.engine)
      ? { TERMINAL_MODEL: sched.model || engineDefaultModel(sched.engine) }
      : {}),
    ...(resolveEffort(sched) ? { TERMINAL_EFFORT: resolveEffort(sched) } : {}),
    ...(sched.engine === 'openai-compat'
      ? {
          ...(openAICompatBaseUrl() ? { OPENAI_BASE_URL: openAICompatBaseUrl() } : {}),
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'none',
        }
      : {}),
    // Per-schedule env vars (Schedule.env). Spread LAST so they can
    // override TERMINAL_* if the operator really wants (rare), but the
    // main use case is parameterizing the prompt — e.g. a schedule
    // labeled "(bolt)" pinning BEACON_PROJECT=bolt so the agent drains
    // that specific Beacon project queue instead of falling back to the
    // global config's default project.
    ...(sched.env && typeof sched.env === 'object' ? sched.env : {}),
  }
}

// `script` pseudo-TTY wrapper differs by platform:
//  - macOS/BSD: `script -q /dev/null <cmd...>` takes the command as trailing
//    argv and exits with the command's status.
//  - util-linux (Linux): needs `-c "<cmd>"` and, crucially, `-e/--return` to
//    propagate the child's exit code. WITHOUT -e it always exits 0, so every
//    run — including failures — would be recorded as done.
export function scriptArgsFor(isMac: boolean, shell: string, cmd: string): string[] {
  return isMac
    ? ['-q', '/dev/null', shell, '-l', '-c', cmd]
    : ['-q', '-e', '-c', `${shq(shell)} -l -c ${shq(cmd)}`, '/dev/null']
}

// zsh is macOS's default but usually absent on Linux hosts — fall back to bash there.
export function shellFor(isMac: boolean): string {
  return process.env.SHELL || (isMac ? '/bin/zsh' : '/bin/bash')
}
