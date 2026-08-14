// terminal-cron — headless runner for TerMinal scheduled agent runs.
//
// launchd invokes:  <bun> terminal-cron run <scheduleId>
// also supported:   <bun> terminal-cron watchdog          (one-shot fleet check)
//
// SELF-CONTAINED on purpose: the shipped artifact (bin/terminal-cron) is a
// single bundled file with no imports from the TerMinal app bundle, so it keeps
// working even if the app moves or is closed. Reads/writes only
// ~/.config/TerMinal/*. The app installs an up-to-date copy to
// ~/.config/TerMinal/bin/terminal-cron and points launchd at that stable path.
//
// Per run it:
//   - sweeps stale runs (status:running with no live process for >2h) and
//     marks them failed (the watchdog half — every run is also a heartbeat
//     check for the fleet, so absence-of-scheduler-firing gets caught the
//     next time any agent runs)
//   - honors the kill-switch (~/.config/TerMinal/agents/disabled.json) and
//     bails fast if this scheduleId is disabled
//   - creates an isolated git worktree off the default base
//   - runs codex / claude / cursor-agent through `script -q /dev/null` so the
//     wrapped CLI thinks it's in a TTY and streams stdout/stderr in real time
//     to the run log (otherwise claude -p buffers everything until exit, and
//     the log is empty until the run is over)
//   - records the run, appends an activity event, stamps lastRun back onto
//     the schedule
//   - on failure: files a global HITL item + a backlog ticket on the
//     affected repo (best-effort) + circuit-breaks the schedule after N
//     consecutive failures (auto-disable + ping)
import { maybeRunRetention } from './retention'
import { maybeRunReviewPatterns } from './review-patterns'
import { runSchedule } from './run-schedule'
import { runWatchdog } from './watchdog'

// Every dispatch below was an unhandled rejection waiting to happen: a `.then`
// with no `.catch` means a throw skips `process.exit` entirely, and launchd
// records whatever the runtime decides — frequently exit 0. A failed scheduled
// run then looks exactly like a successful one, which is the silent-failure
// mode this runner exists to avoid (tickets 100/101). Route it: log, and exit
// non-zero so the run record and the daemon agree that it failed.
function die(what: string): (e: unknown) => void {
  return (e: unknown) => {
    console.error(`terminal-cron: ${what} failed: ${(e as Error)?.stack || e}`)
    process.exit(1)
  }
}

export function main(argv: string[]): void {
  const [, , action, arg] = argv
  if (action === 'run' && arg) {
    runSchedule(arg)
      .then((c) => process.exit(c))
      .catch(die(`run ${arg}`))
  } else if (action === 'watchdog') {
    runWatchdog()
      .then((c) => process.exit(c))
      .catch(die('watchdog'))
  } else if (action === 'review-patterns') {
    maybeRunReviewPatterns(arg === '--force')
      .then(() => process.exit(0))
      .catch(die('review-patterns'))
  } else if (action === 'retention') {
    maybeRunRetention(true)
      .then((r) => {
        console.log(JSON.stringify(r))
        process.exit(0)
      })
      .catch(die('retention'))
  } else {
    console.error('usage: terminal-cron run <scheduleId>')
    console.error('       terminal-cron watchdog')
    console.error('       terminal-cron review-patterns [--force]')
    console.error('       terminal-cron retention')
    process.exit(2)
  }
}

main(process.argv)
