import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { buildRunner, OUT } from '../../scripts/build-runner'

// bin/terminal-cron is a BUILT artifact that stays committed, because the flows
// that execute it run straight out of a checkout: host-provision.ts scp's the
// file to a remote host, docker/build-agent-image.sh bakes it into an image,
// and the app copies it to ~/.config/TerMinal/bin. A source edit without a
// rebuild would ship the OLD runner from all three — silently. So regenerate
// and diff rather than trusting the committer to remember.
describe('bin/terminal-cron is the current build of src/runner', () => {
  test('regenerating produces byte-identical output', async () => {
    const fresh = await buildRunner()
    const committed = readFileSync(OUT, 'utf8')
    if (fresh !== committed) {
      throw new Error('bin/terminal-cron is stale — run: bun run build:runner')
    }
    expect(fresh).toBe(committed)
  }, 60_000)

  test('the artifact is executable and starts with the bun shebang', () => {
    const committed = readFileSync(OUT, 'utf8')
    expect(committed.startsWith('#!/usr/bin/env bun\n')).toBe(true)
    // launchd/systemd invoke it as `<bun> <path>`, but host-provision and the
    // agent image both exec it directly.
    expect(statSync(OUT).mode & 0o111).toBeGreaterThan(0)
  })
})
