import { describe, expect, test } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { TARGETS, buildBin, outFor } from '../scripts/build-bin'

// The bin/ artifacts are BUILT and stay committed, because the flows that
// execute them run straight out of a checkout: host-provision.ts scp's the file
// to a remote host, docker/build-agent-image.sh bakes it into an image, and the
// app copies it to ~/.config/TerMinal/bin. A source edit without a rebuild would
// ship the OLD script from all three — silently. So regenerate and diff rather
// than trusting the committer to remember.
describe('every bin/ artifact is the current build of its source', () => {
  for (const name of Object.keys(TARGETS)) {
    test(`regenerating bin/${name} produces byte-identical output`, async () => {
      const fresh = await buildBin(name)
      const committed = readFileSync(outFor(name), 'utf8')
      if (fresh !== committed) {
        throw new Error(`bin/${name} is stale — run: bun run build:bin`)
      }
      expect(fresh).toBe(committed)
    }, 60_000)

    test(`bin/${name} is executable and starts with the bun shebang`, () => {
      const committed = readFileSync(outFor(name), 'utf8')
      expect(committed.startsWith('#!/usr/bin/env bun\n')).toBe(true)
      // launchd/systemd invoke it as `<bun> <path>`, but host-provision and the
      // agent image both exec it directly.
      expect(statSync(outFor(name)).mode & 0o111).toBeGreaterThan(0)
    })
  }

  test('the target list actually covers the scripts we build', () => {
    // A table that quietly loses an entry turns this whole suite into a no-op.
    expect(Object.keys(TARGETS)).toContain('terminal-cron')
    expect(Object.keys(TARGETS)).toContain('terminal-monitor')
  })
})
