import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Ticket 98. The README shipped three images leaking the developer's checkout
// and home-directory paths onto a public page. Ticket 76 had already added a CI
// grep for leaked paths in TEXT — and it could not see this, because the leak
// was pixels.
//
// (Deliberately described rather than quoted: writing the offending strings into
// a tracked file is what the ticket-76 guard exists to stop, and doing it in a
// COMMENT trips it just the same. Learned the hard way — see PR #247.)
//
// So the guard has to be about PROVENANCE, not content: images captured from
// the sandbox (`bun run shots`) cannot contain personal state, because the
// process that made them had none. A hand-taken screenshot can.
//
// The capture uses a fixed 1600x1000 viewport, so every generated image is
// exactly that size. A screenshot taken by hand — any window, any display, any
// crop — essentially never is. That is a cheap, deterministic proxy for "this
// came from the sandbox" with no OCR and no CI cost.

const ROOT = resolve(import.meta.dir, '../..')

/** Exactly what tests/ux/readme-capture.ts sets. */
const CAPTURE_WIDTH = 1600
const CAPTURE_HEIGHT = 1000

/** Every image README.md renders. */
const README_SHOTS = ['terminal', 'agents', 'tickets', 'runs', 'schedules']

/** Width/height out of a PNG's IHDR chunk — no image library needed. */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file)
  expect(buf.subarray(1, 4).toString('ascii'), `${file} is not a PNG`).toBe('PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('README screenshots come from the sandbox capture (ticket 98)', () => {
  for (const name of README_SHOTS) {
    test(`docs/${name}.png has the capture viewport's exact dimensions`, () => {
      const { width, height } = pngSize(join(ROOT, 'docs', `${name}.png`))
      expect(
        { width, height },
        `docs/${name}.png is not ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT} — it was probably taken by ` +
          'hand rather than by `bun run shots`, so it may contain real local state. Regenerate it.',
      ).toEqual({ width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT })
    })
  }

  test('README references exactly the images this guard covers', () => {
    // Otherwise someone adds a sixth image, it never gets checked, and the
    // guard quietly protects a subset while looking complete.
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    const referenced = [...readme.matchAll(/docs\/([a-z0-9-]+)\.png/g)].map((m) => m[1])
    expect([...new Set(referenced)].sort()).toEqual([...README_SHOTS].sort())
  })

  test('the capture harness still uses these dimensions', () => {
    // If the viewport changes and this file does not, every image fails with a
    // confusing message. Pin them together.
    const src = readFileSync(join(ROOT, 'tests/ux/readme-capture.ts'), 'utf8')
    expect(src).toContain(`width: ${CAPTURE_WIDTH}, height: ${CAPTURE_HEIGHT}`)
  })
})
