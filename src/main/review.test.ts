import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readScreenshots } from './review'

// A 1x1 transparent PNG — real bytes so the base64 data URL round-trips.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('readScreenshots', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gt-review-'))
    mkdirSync(join(dir, 'screenshots'), { recursive: true })
    writeFileSync(join(dir, 'screenshots', 'after.png'), PNG_1x1)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('returns [] when no screenshots.json exists', () => {
    expect(readScreenshots(dir)).toEqual([])
  })

  test('reads entries and embeds a data URL for each existing image', () => {
    writeFileSync(
      join(dir, 'screenshots.json'),
      JSON.stringify({
        screenshots: [
          {
            id: 'sc-a',
            caption: 'Panels editor — after',
            path: 'screenshots/after.png',
            kind: 'after',
            findingId: '12345678',
          },
        ],
      }),
    )
    const out = readScreenshots(dir)
    expect(out).toHaveLength(1)
    expect(out[0].caption).toBe('Panels editor — after')
    expect(out[0].kind).toBe('after')
    expect(out[0].findingId).toBe('12345678')
    expect(out[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    // round-trips to the same bytes
    expect(Buffer.from(out[0].dataUrl.split(',')[1], 'base64')).toEqual(PNG_1x1)
  })

  test('accepts a bare array as well as { screenshots: [...] }', () => {
    writeFileSync(
      join(dir, 'screenshots.json'),
      JSON.stringify([{ caption: 'x', path: 'screenshots/after.png' }]),
    )
    expect(readScreenshots(dir)).toHaveLength(1)
  })

  test('skips entries whose image file is missing', () => {
    writeFileSync(
      join(dir, 'screenshots.json'),
      JSON.stringify([{ caption: 'gone', path: 'screenshots/nope.png' }]),
    )
    expect(readScreenshots(dir)).toEqual([])
  })

  test('rejects path traversal outside the review dir', () => {
    writeFileSync(
      join(dir, 'screenshots.json'),
      JSON.stringify([{ caption: 'evil', path: '../../../../etc/hosts' }]),
    )
    expect(readScreenshots(dir)).toEqual([])
  })

  test('drops an unknown kind but keeps the screenshot', () => {
    writeFileSync(
      join(dir, 'screenshots.json'),
      JSON.stringify([{ caption: 'x', path: 'screenshots/after.png', kind: 'bogus' }]),
    )
    const out = readScreenshots(dir)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBeUndefined()
  })
})
