export type BootstrapState = 'full' | 'partial' | 'none'
export type BootstrapStatus = {
  state: BootstrapState
  bootstrapped: boolean
  missing: string[]
  message: string
}

export const BOOTSTRAP_MARKERS = [
  { label: '.agents', anyOf: ['.agents'] },
  { label: 'backlog', anyOf: ['.TerMinal/backlog', 'backlog'] },
  { label: 'docs', anyOf: ['docs'] },
  { label: 'sessions', anyOf: ['.TerMinal/sessions', 'sessions'] },
  { label: '.claude/skills', anyOf: ['.claude/skills'] },
  { label: '.codex/skills', anyOf: ['.codex/skills'] },
] as const

export const BOOTSTRAP_MARKER_LABELS = BOOTSTRAP_MARKERS.map((m) => m.label)

export function classifyBootstrapStatus(
  repoRoot: string,
  hasPath: (rel: string) => boolean,
): BootstrapStatus {
  if (!repoRoot) {
    return {
      state: 'none',
      bootstrapped: false,
      missing: [...BOOTSTRAP_MARKER_LABELS],
      message: 'No repo selected.',
    }
  }
  let present = 0
  const missing: string[] = []
  for (const marker of BOOTSTRAP_MARKERS) {
    let ok = false
    try {
      ok = marker.anyOf.some((rel) => hasPath(rel))
    } catch {
      ok = false
    }
    if (ok) present++
    else missing.push(marker.label)
  }
  if (present === BOOTSTRAP_MARKERS.length) {
    return {
      state: 'full',
      bootstrapped: true,
      missing: [],
      message: 'Project-template workflow files are present.',
    }
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
