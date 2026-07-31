#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Whole-run effect canary for ticket 0115. Run it with `bun run test:effects`.
//
// The unit tests assert the guard refuses. This asserts the OUTCOME across a
// full `bun test`: zero outbound requests, zero activity events. Storage got a
// canary when a test destroyed the real agent registry; effects need one for the
// same reason — the failure mode is silent right up until a phone buzzes.
//
// Two independent observations, neither of which trusts the guard:
//   - scripts/effect-canary-preload.ts wraps `fetch` and logs anything
//     non-loopback (Telegram, APNs, webhooks).
//   - HOME points at a throwaway dir, so any code still resolving the activity
//     feed through `homedir()` — the exact bug that let a test append to the
//     operator's real feed, which the running app mirrors to his phone — leaves
//     its events there, where we count them instead of him reading them.

const out = join(mkdtempSync(join(tmpdir(), 'tm-effect-canary-')), 'findings.log')
const home = mkdtempSync(join(tmpdir(), 'tm-effect-canary-home-'))
writeFileSync(out, '')

const res = spawnSync(
  'bun',
  ['test', '--preload', './scripts/effect-canary-preload.ts', ...process.argv.slice(2)],
  {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, HOME: home, EFFECT_CANARY_OUT: out },
  },
)

const lines = (path: string) =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []

const requests = lines(out)
const events = lines(join(home, '.config', 'TerMinal', 'activity.jsonl'))

console.log(
  `\neffect canary: ${requests.length} outbound request(s), ${events.length} activity event(s)`,
)
for (const line of [...requests, ...events.map((e) => `ACTIVITY ${e.slice(0, 160)}`)].slice(0, 20))
  console.log(`  ${line}`)

if (requests.length || events.length) {
  console.error('\nThe suite emitted side effects. See src/main/effect-guard.ts.')
  process.exit(1)
}
if (res.status !== 0) {
  console.error('\nNo effects escaped, but the suite itself failed.')
  process.exit(res.status ?? 1)
}
console.log('effect canary: clean')
