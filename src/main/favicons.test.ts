import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheFavicon, faviconDir, readFaviconDataUrl } from './favicons'

let dir = ''
const prev = process.env.TERMINAL_CONFIG_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tm-favicons-'))
  process.env.TERMINAL_CONFIG_DIR = dir
})
afterEach(() => {
  if (prev === undefined) delete process.env.TERMINAL_CONFIG_DIR
  else process.env.TERMINAL_CONFIG_DIR = prev
  rmSync(dir, { recursive: true, force: true })
})

const seed = (name: string, bytes: Buffer): string => {
  mkdirSync(faviconDir(), { recursive: true })
  writeFileSync(join(faviconDir(), name), bytes)
  return name
}

describe('readFaviconDataUrl', () => {
  test('serves cached bytes as a data URL with the mime the extension implies', () => {
    seed('abcd1234.png', Buffer.from([1, 2, 3]))
    expect(readFaviconDataUrl('abcd1234.png')).toBe(
      `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
    )
    seed('abcd1235.ico', Buffer.from([4]))
    expect(readFaviconDataUrl('abcd1235.ico')).toStartWith('data:image/x-icon;base64,')
  })

  test('a renderer-supplied path never escapes the cache dir', () => {
    // The renderer hands this string over IPC, so it is untrusted input even
    // though only our own code writes the values it should hold.
    writeFileSync(join(dir, 'secret.png'), Buffer.from('shh'))
    for (const bad of ['../secret.png', '/etc/passwd', 'sub/abcd1234.png', '', 'abcd1234.sh']) {
      expect(readFaviconDataUrl(bad)).toBe('')
    }
  })

  test('a missing cache file is silent, not an error', () => {
    expect(readFaviconDataUrl('deadbeef.png')).toBe('')
  })
})

describe('cacheFavicon', () => {
  const okResponse = (body: Uint8Array, type = 'image/png'): Response =>
    new Response(body, { status: 200, headers: { 'content-type': type } })

  test('writes the bytes under the per-origin name and returns it', async () => {
    const bytes = new Uint8Array([9, 8, 7])
    const name = await cacheFavicon('https://example.com/page', 'https://example.com/favicon.ico', {
      fetchImpl: async () => okResponse(bytes),
    })
    expect(name).toMatch(/^[0-9a-f]{8,}\.png$/)
    expect([...readFileSync(join(faviconDir(), name))]).toEqual([9, 8, 7])
  })

  test('a changed icon overwrites the same slot instead of growing the cache', async () => {
    const first = await cacheFavicon('https://example.com/', 'https://example.com/a.png', {
      fetchImpl: async () => okResponse(new Uint8Array([1])),
    })
    const second = await cacheFavicon('https://example.com/other', 'https://example.com/b.png', {
      fetchImpl: async () => okResponse(new Uint8Array([2])),
    })
    expect(second).toBe(first)
    expect([...readFileSync(join(faviconDir(), first))]).toEqual([2])
  })

  test('every failure mode is silent — the caller keeps the globe', async () => {
    const fail = async (fetchImpl: () => Promise<Response>): Promise<string> =>
      cacheFavicon('https://example.com/', 'https://example.com/icon.png', { fetchImpl })

    expect(await fail(async () => new Response('', { status: 404 }))).toBe('')
    expect(
      await fail(async () => {
        throw new Error('offline')
      }),
    ).toBe('')
    // Not an image: a captive-portal HTML page must never be cached as an icon.
    expect(await fail(async () => okResponse(new Uint8Array([1]), 'text/html'))).toBe('')
    // Oversized: a 5MB "favicon" is a bug or an attack, not an icon.
    expect(await fail(async () => okResponse(new Uint8Array(600_000)))).toBe('')
    expect(await fail(async () => okResponse(new Uint8Array(0)))).toBe('')
    // …and nothing was written: a failed fetch leaves no half-cached file.
    expect(existsSync(faviconDir()) ? readdirSync(faviconDir()) : []).toEqual([])
  })

  test('refuses non-http(s) page or icon URLs', async () => {
    const never = async (): Promise<Response> => {
      throw new Error('must not fetch')
    }
    expect(
      await cacheFavicon('file:///etc/passwd', 'https://a.test/i.png', { fetchImpl: never }),
    ).toBe('')
    expect(await cacheFavicon('https://a.test/', 'file:///etc/passwd', { fetchImpl: never })).toBe(
      '',
    )
    expect(await cacheFavicon('https://a.test/', '', { fetchImpl: never })).toBe('')
  })
})
