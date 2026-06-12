import { spawnSync } from 'node:child_process'
import type {
  AgentQuality,
  AgentRun,
  AgentRunEvaluation,
  AgentRunEvaluationCheck,
  AgentRunStatus,
  Engine,
} from './agents'

const LOGIN_SHELL = process.env.SHELL || '/bin/zsh'

export type AgentRunEvaluationSpec = {
  engine: Engine
  quality?: AgentQuality
}

function tail(text: string, max = 800): string {
  const t = text.trim()
  return t.length > max ? `...${t.slice(-max)}` : t
}

export function evaluateAgentRun(
  run: AgentRun,
  spec: AgentRunEvaluationSpec,
  status: AgentRunStatus,
  append: (chunk: string) => void,
): AgentRunEvaluation {
  const checks: AgentRunEvaluationCheck[] = []
  const quality = spec.quality || {}
  const deterministicChecks = quality.deterministicChecks || []

  for (const check of deterministicChecks) {
    const cwd = check.cwd === 'repo' ? run.repoRoot : run.worktree
    const result = spawnSync(LOGIN_SHELL, ['-lc', check.command], {
      cwd,
      encoding: 'utf8',
      timeout: check.timeoutMs || 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = tail([result.stdout, result.stderr].filter(Boolean).join('\n'))
    const timedOut = result.error?.name === 'TimeoutError' || result.signal === 'SIGTERM'
    checks.push({
      id: check.id,
      title: check.title,
      command: check.command,
      required: check.required,
      status: result.status === 0 ? 'pass' : 'fail',
      detail: timedOut
        ? `timed out after ${check.timeoutMs || 30_000}ms`
        : output || `exit ${result.status ?? 'unknown'}`,
    })
  }

  const requiredFailed = checks.some((check) => check.required && check.status === 'fail')
  const runPassed = status === 'done' && !requiredFailed
  const evaluation: AgentRunEvaluation = {
    status: runPassed ? 'pass' : status === 'done' ? 'incomplete' : 'fail',
    evaluatedAt: Date.now(),
    summary: runPassed
      ? 'Run exited successfully and required deterministic checks passed.'
      : status === 'done'
        ? 'Run exited successfully, but at least one required deterministic check failed.'
        : `Run ended with status ${status}.`,
    checks,
  }
  if (quality.judge) {
    evaluation.judge = {
      enabled: !!quality.judge.enabled,
      mode: quality.judge.mode || 'deterministic',
      status: 'not-run',
      model: quality.judge.model,
      detail: quality.judge.enabled
        ? 'LLM judge is configured but not invoked by the deterministic completion pass yet.'
        : 'Judge disabled for this agent.',
    }
  }

  if (checks.length || evaluation.judge) {
    const lines = [
      '',
      '━━ evaluation ━━',
      `status: ${evaluation.status}`,
      evaluation.summary,
      ...checks.map(
        (check) =>
          `- ${check.status.toUpperCase()}${check.required ? ' required' : ''}: ${check.title}${check.command ? ` · ${check.command}` : ''}${check.detail ? `\n  ${check.detail}` : ''}`,
      ),
      evaluation.judge
        ? `- JUDGE ${evaluation.judge.status}: ${evaluation.judge.mode || 'deterministic'} · ${evaluation.judge.detail}`
        : '',
      '',
    ].filter(Boolean)
    append(`${lines.join('\n')}\n`)
  }
  return evaluation
}
