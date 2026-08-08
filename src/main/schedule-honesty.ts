// Honest results for schedule mutations that cross a network (ADR-0002).
//
// Every helper here replaced a swallowed failure in ipc/schedules.ts:
//   - `routeRemoveSchedule(prev).catch(() => {})` — SSH to the OLD host fails and
//     its systemd timer keeps firing forever with nothing said (teardownWarning).
//   - `remoteSchedules.remove/.toggle(...).catch(() => false)` — a network blip
//     read exactly like the host refusing (remoteMutation).
//   - a remote-attached save that installs no timer yet stores enabled:true, so
//     the row renders healthy and never fires (REMOTE_ENABLED_REJECTION).
//
// Pure, so the shapes the UI depends on are unit-testable without SSH.

export type MutationResult =
  { ok: true; warning?: string } | { ok: false; reason: 'refused' | 'unreachable'; error: string }

/** Warning for a schedule that changed trigger layers while the OLD trigger's
 *  teardown failed. Names the layer/host still holding a live trigger. */
export function teardownWarning(
  prev: { host?: string; runtime?: string },
  hostLabel: string | undefined,
  error?: string,
): string {
  const where = prev.host ? `on ${hostLabel || prev.host}` : 'in local launchd'
  const what = prev.runtime === 'k8s' ? 'CronJob' : prev.host ? 'systemd timer' : 'launchd job'
  return `could not remove the old ${what} ${where} — it is still installed and will keep firing: ${error || 'unknown error'}`
}

/** Run a boolean-returning remote mutation and keep "the host refused" separate
 *  from "we never reached the host". */
export async function remoteMutation(
  hostLabel: string,
  run: () => Promise<boolean>,
): Promise<MutationResult> {
  try {
    const ok = await run()
    return ok
      ? { ok: true }
      : {
          ok: false,
          reason: 'refused',
          error: `${hostLabel} refused — no such schedule on that host`,
        }
  } catch (e) {
    return {
      ok: false,
      reason: 'unreachable',
      error: `could not reach ${hostLabel}: ${(e as Error)?.message || String(e)}`,
    }
  }
}

/** A schedule saved while attached to a remote gets a record on the host but NO
 *  timer (the remote daemon writer isn't installed), so `enabled: true` would be
 *  a lie. Reject with the honest alternative rather than pretending. */
export const REMOTE_ENABLED_REJECTION =
  'a schedule created over an attached remote session gets no recurring timer (that needs the remote daemon) — save it paused and use Run Now, which works over SSH'
