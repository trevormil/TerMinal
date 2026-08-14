import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react'
import type { PrChecksSummary } from '../../lib/types'

// The per-row CI chip on the MR list.
//
// One `gh pr list --json number,statusCheckRollup` call answers the WHOLE list,
// so the fetch lives in a module-level store rather than in the row: a list of
// forty PRs each fetching its own checks is forty subprocesses and a rate-limit
// incident. Rows subscribe; the store coalesces and throttles.

const cache = new Map<string, Record<number, PrChecksSummary>>()
const listeners = new Map<string, Set<() => void>>()
const inFlight = new Map<string, Promise<void>>()
const lastFetch = new Map<string, number>()

/** Floor between two fetches for the same repo, however many rows ask. */
const THROTTLE_MS = 10_000
/** How often a row with running checks asks the store to refresh. */
const REPOLL_MS = 20_000

function load(repoRoot: string): void {
  const existing = inFlight.get(repoRoot)
  if (existing) return
  if (Date.now() - (lastFetch.get(repoRoot) ?? 0) < THROTTLE_MS) return
  const p = window.gt.githubReview
    .checksSummaries(repoRoot)
    .then((r) => {
      // Off GitHub the answer is `supported: false` — leave the cache empty so
      // every chip renders nothing, which is the correct GitLab behaviour.
      if (r.supported) cache.set(repoRoot, r.byIid)
    })
    .catch(() => {
      /* the chip is decoration; a failed probe must never break the list */
    })
    .finally(() => {
      inFlight.delete(repoRoot)
      lastFetch.set(repoRoot, Date.now())
      for (const l of listeners.get(repoRoot) ?? []) l()
    })
  inFlight.set(repoRoot, p)
}

/** This PR's checks roll-up, or null while unknown / not GitHub. */
export function useChecksSummary(repoRoot: string, iid: number): PrChecksSummary | null {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!repoRoot) return
    let set = listeners.get(repoRoot)
    if (!set) listeners.set(repoRoot, (set = new Set()))
    set.add(bump)
    load(repoRoot)
    const t = setInterval(() => {
      if (cache.get(repoRoot)?.[iid]?.state === 'pending') load(repoRoot)
    }, REPOLL_MS)
    return () => {
      set.delete(bump)
      clearInterval(t)
    }
  }, [repoRoot, iid])
  return cache.get(repoRoot)?.[iid] ?? null
}

const COLOR: Record<PrChecksSummary['state'], string> = {
  failed: 'var(--gt-red)',
  pending: 'var(--gt-text-muted)',
  success: 'var(--gt-green)',
  none: 'var(--gt-text-faint)',
}

// The repo the list is showing, supplied once by the tab. A context rather than
// a prop threaded through the group/stack/row layers: the chip is the only
// thing that needs it, and three intermediate components growing a `repoRoot`
// they never read is exactly the coupling that makes a list hard to restyle.
const ChecksRepoContext = createContext('')

export function ChecksRepoProvider({
  repoRoot,
  children,
}: {
  repoRoot: string
  children: ReactNode
}) {
  return <ChecksRepoContext.Provider value={repoRoot}>{children}</ChecksRepoContext.Provider>
}

/**
 * `2 failed` on a list row, coloured by the worst outcome.
 *
 * A PR with no checks renders nothing at all — "0 checks" over a repo with no
 * CI is a fact the reviewer would act on (design-system.md §6, absent-not-zero).
 */
export function ChecksChip({ iid }: { iid: number }) {
  const repoRoot = useContext(ChecksRepoContext)
  const s = useChecksSummary(repoRoot, iid)
  if (!s || s.state === 'none') return null
  const text =
    s.state === 'failed'
      ? `${s.failed} failed`
      : s.state === 'pending'
        ? `${s.pending} running`
        : `${s.passed} passed`
  return (
    <span
      className="inline-flex items-center gap-1 tabular-nums"
      style={{ color: COLOR[s.state] }}
      title={`${s.passed} passed · ${s.failed} failed · ${s.pending} running · ${s.other} skipped`}
    >
      {text}
    </span>
  )
}
