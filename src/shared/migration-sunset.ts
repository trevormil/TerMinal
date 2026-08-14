// The legacy repo→sidecar migration window (ADR-0020) has an END DATE.
//
// ADR-0020 moved personal workflow state out of the repo and into a
// per-project sidecar, and paid for a gradual cutover: reads merge the old
// in-repo locations, a banner offers the one-time move, and nothing is ever
// deleted. That compatibility layer is the expensive half of the decision —
// every resolver carries a legacy branch, and every one of those branches is a
// route for state to leak back into a shared checkout.
//
// So the window closes on its own. Before MIGRATION_SUNSET nothing changes.
// From that date the AMBIENT half of the flow is off: legacy in-repo state is
// no longer read, and the app stops offering the move unprompted. The EXPLICIT
// manual migrate stays callable forever — a repo that shows up years late must
// still be able to move its state, it just no longer happens by itself.
//
// The boundary is UTC midnight so before/on/after is the same instant on every
// machine, and every caller takes an injectable clock so the behaviour is
// testable without touching the system time.

/** The day the ambient migration flow stops. ISO date, UTC. */
export const MIGRATION_SUNSET = '2026-10-13'

const SUNSET_MS = Date.parse(`${MIGRATION_SUNSET}T00:00:00Z`)

/**
 * Is the gradual-migration window still open? True strictly BEFORE the sunset
 * date — on the date itself the window is closed, which is what "sunset on
 * 2026-10-13" means to a user reading the banner.
 */
export function migrationWindowOpen(now: Date = new Date()): boolean {
  return now.getTime() < SUNSET_MS
}
