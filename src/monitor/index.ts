// terminal-monitor — the Monitoring daemon. A dedicated process (its own
// launchd job com.terminal.monitor, NOT terminal-cron) that probes registered
// monitors and files Inbox items on transitions. Pure, deterministic
// infrastructure observability: zero inference, no agents, no LLM.
//
//   terminal-monitor tick          run every monitor that is due (launchd fires this)
//   terminal-monitor run <id>      run one monitor now, regardless of schedule
//   terminal-monitor digest        file the daily digest for monitors that want it
//
// SELF-CONTAINED on purpose: the shipped artifact (bin/terminal-monitor) is a
// single bundled file with no imports from the TerMinal app bundle, so it keeps
// working from ~/.config/TerMinal/bin under launchd even when the app is closed.
// That is what lets it share the pure logic (src/shared/monitor-flap.ts,
// src/shared/monitor-classify.ts) with the app instead of mirroring it — the
// bundler inlines those modules, so there is nothing to resolve at runtime.
import { runOne } from './run'
import { readMonitors } from './state'
import { digest, tick } from './tick'

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[2]
  if (cmd === 'run') {
    const m = readMonitors().find((x) => x.id === argv[3])
    if (!m) {
      console.error(`monitor ${argv[3]} not found`)
      process.exit(1)
    }
    await runOne(m, Date.now())
  } else if (cmd === 'digest') {
    await digest()
  } else {
    await tick()
  }
}

await main(process.argv)
