// Pure pipeline logic — no electron/disk imports, so it's unit-testable.
// A pipeline is a chain of stages run sequentially in ONE worktree: the first
// step is the task itself, later stages append review/iterate passes.
export type Step = { label: string; prompt: string }

const REVIEW_STAGE: Step = {
  label: 'review',
  prompt:
    'Now act as a meticulous senior reviewer of the work just done on this branch. Inspect `git diff` against the base branch and `git log`. Evaluate correctness, security, architecture, and quality. Fix any real issues you find directly in this worktree — with tests — and commit. If a PR is open for this branch, update it. End with a concise review summary: what you found and what you changed.',
}
const ITERATE_STAGE: Step = {
  label: 'iterate',
  prompt:
    'Now iterate until this branch is merge-ready: resolve any remaining review findings and TODOs, make the test suite and build pass, and tighten edge cases — keep changes surgical. Commit your work and update the PR if one is open. End with the final status (tests/build green?) and a short summary.',
}

export type PipelineId = 'single' | 'review' | 'review-iterate'
export const PIPELINES: Record<
  PipelineId,
  { id: PipelineId; title: string; description: string; stages: Step[] }
> = {
  single: { id: 'single', title: 'Single run', description: 'Just the task — one pass.', stages: [] },
  review: {
    id: 'review',
    title: 'Review',
    description: 'Task → a reviewer pass that fixes issues it finds.',
    stages: [REVIEW_STAGE],
  },
  'review-iterate': {
    id: 'review-iterate',
    title: 'Review + Iterate',
    description: 'Task → review → iterate until merge-ready.',
    stages: [REVIEW_STAGE, ITERATE_STAGE],
  },
}

/** Valid pipeline ids — used by the Telegram parser to classify a token. */
export const PIPELINE_IDS = new Set<string>(Object.keys(PIPELINES))

export function listPipelines(): { id: PipelineId; title: string; description: string }[] {
  return Object.values(PIPELINES).map(({ id, title, description }) => ({ id, title, description }))
}

function resolvePipeline(pipelineId?: string) {
  return PIPELINES[(pipelineId as PipelineId) || 'single'] || PIPELINES.single
}

/** Compose the runnable steps: base task + pipeline stages, each prefixed with
 *  the persona framing (if any). */
export function composeSteps(base: Step, personaPrompt: string | null, pipelineId?: string): Step[] {
  return [base, ...resolvePipeline(pipelineId).stages].map((s) => ({
    label: s.label,
    prompt: personaPrompt ? `${personaPrompt}\n\n---\n\n${s.prompt}` : s.prompt,
  }))
}

/** Display label for a run's pipeline — undefined for the default single run. */
export function pipelineLabel(pipelineId?: string): string | undefined {
  const p = resolvePipeline(pipelineId)
  return p.id === 'single' ? undefined : p.title
}
