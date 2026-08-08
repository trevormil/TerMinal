export type BootstrapState = 'full' | 'partial' | 'none'
export type BootstrapStatus = {
  state: BootstrapState
  bootstrapped: boolean
  missing: string[]
  message: string
}

// What bootstrap actually leaves in a repo, and nothing else.
//
// Skills are no longer a marker: both harnesses load them globally from the tm
// plugin, so their presence says nothing about this repo. Neither are backlog
// and sessions — workflow state lives in the per-project sidecar now, so a
// CORRECTLY migrated repo has neither directory, and marking them required
// would report every migrated repo as "partial" forever.
export const BOOTSTRAP_MARKERS = [
  { label: '.agents', anyOf: ['.agents'] },
  { label: 'docs', anyOf: ['docs'] },
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
