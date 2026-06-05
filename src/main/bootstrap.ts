export type BootstrapState = 'full' | 'partial' | 'none'
export type BootstrapStatus = {
  state: BootstrapState
  bootstrapped: boolean
  missing: string[]
  message: string
}

export const BOOTSTRAP_MARKERS = [
  '.agents',
  'backlog',
  'docs',
  'sessions',
  '.claude/skills',
  '.codex/skills',
] as const

export function classifyBootstrapStatus(
  repoRoot: string,
  hasPath: (rel: string) => boolean,
): BootstrapStatus {
  if (!repoRoot) {
    return { state: 'none', bootstrapped: false, missing: [...BOOTSTRAP_MARKERS], message: 'No repo selected.' }
  }
  let present = 0
  const missing: string[] = []
  for (const marker of BOOTSTRAP_MARKERS) {
    let ok = false
    try {
      ok = hasPath(marker)
    } catch {
      ok = false
    }
    if (ok) present++
    else missing.push(marker)
  }
  if (present === BOOTSTRAP_MARKERS.length) {
    return { state: 'full', bootstrapped: true, missing: [], message: 'Project-template workflow files are present.' }
  }
  if (present === 0) {
    return {
      state: 'none',
      bootstrapped: false,
      missing,
      message: 'This repo is not bootstrapped with project-template.',
    }
  }
  return {
    state: 'partial',
    bootstrapped: false,
    missing,
    message: `This repo is partially bootstrapped. Bootstrap will repair missing workflow files: ${missing.join(', ')}.`,
  }
}
