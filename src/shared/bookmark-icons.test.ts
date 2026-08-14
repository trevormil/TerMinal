import { describe, expect, test } from 'bun:test'
import {
  faviconCacheName,
  isFaviconCacheName,
  normalizeIconEmoji,
  parseBookmarkIcons,
  resolveBookmarkIcon,
  setBookmarkIcon,
} from './bookmark-icons'

describe('faviconCacheName', () => {
  test('is per-origin, so every page of a site overwrites one file', () => {
    const a = faviconCacheName('https://example.com/one?q=1', 'image/png')
    const b = faviconCacheName('https://example.com/two#frag', 'image/png')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8,}\.png$/)
  })

  test('different origins do not collide (scheme, host and port all count)', () => {
    const names = [
      faviconCacheName('https://example.com/', 'image/png'),
      faviconCacheName('https://other.example.com/', 'image/png'),
      faviconCacheName('http://example.com/', 'image/png'),
      faviconCacheName('https://example.com:8443/', 'image/png'),
    ]
    expect(new Set(names).size).toBe(names.length)
  })

  test('host case does not fork the cache', () => {
    expect(faviconCacheName('https://EXAMPLE.com/x', 'image/png')).toBe(
      faviconCacheName('https://example.com/x', 'image/png'),
    )
  })

  test('the extension follows the served content type', () => {
    expect(faviconCacheName('https://a.test/', 'image/x-icon')).toEndWith('.ico')
    expect(faviconCacheName('https://a.test/', 'image/vnd.microsoft.icon')).toEndWith('.ico')
    expect(faviconCacheName('https://a.test/', 'image/svg+xml; charset=utf-8')).toEndWith('.svg')
    expect(faviconCacheName('https://a.test/', 'image/jpeg')).toEndWith('.jpg')
    // Unknown but still an image: keep it, named png, rather than dropping it.
    expect(faviconCacheName('https://a.test/', 'image/avif')).toEndWith('.png')
  })

  test('non-http(s) and unparseable URLs get no cache slot', () => {
    expect(faviconCacheName('file:///etc/passwd', 'image/png')).toBe('')
    expect(faviconCacheName('about:blank', 'image/png')).toBe('')
    expect(faviconCacheName('not a url', 'image/png')).toBe('')
    expect(faviconCacheName('', 'image/png')).toBe('')
  })
})

describe('isFaviconCacheName', () => {
  test('accepts what the generator produces', () => {
    expect(isFaviconCacheName(faviconCacheName('https://a.test/', 'image/png'))).toBe(true)
    expect(isFaviconCacheName(faviconCacheName('https://a.test/', 'image/svg+xml'))).toBe(true)
  })

  test('rejects traversal and anything not shaped like a cache file', () => {
    for (const bad of [
      '',
      '../secrets.png',
      '/etc/passwd',
      'a/b.png',
      'abc.png.sh',
      'abc',
      'ABC.png',
      'abc.exe',
    ]) {
      expect(isFaviconCacheName(bad)).toBe(false)
    }
  })
})

describe('normalizeIconEmoji', () => {
  test('keeps one or two emoji', () => {
    expect(normalizeIconEmoji('🚀')).toBe('🚀')
    expect(normalizeIconEmoji('🚀🔥')).toBe('🚀🔥')
  })

  test('trims whitespace and truncates past two glyphs', () => {
    expect(normalizeIconEmoji('  🚀  ')).toBe('🚀')
    expect(normalizeIconEmoji('🚀🔥🌊')).toBe('🚀🔥')
  })

  test('keeps a multi-codepoint emoji whole', () => {
    // A ZWJ family and a flag are each ONE glyph; a naive slice(0, 2) mangles
    // them into replacement squares.
    expect(normalizeIconEmoji('👩‍👩‍👧')).toBe('👩‍👩‍👧')
    expect(normalizeIconEmoji('🇯🇵')).toBe('🇯🇵')
  })

  test('empty input clears the override', () => {
    expect(normalizeIconEmoji('')).toBe('')
    expect(normalizeIconEmoji('   ')).toBe('')
  })
})

describe('parseBookmarkIcons', () => {
  test('reads a stored map, dropping junk entries', () => {
    const icons = parseBookmarkIcons({
      a: { emoji: '🚀', faviconFile: 'abc12345.png' },
      b: { faviconFile: 'def45678.ico' },
      c: 'nope',
      d: { emoji: 5 },
      e: { faviconFile: '../escape.png' },
    })
    expect(icons).toEqual({
      a: { emoji: '🚀', faviconFile: 'abc12345.png' },
      b: { faviconFile: 'def45678.ico' },
    })
  })

  test('a bookmark set that predates icons parses to an empty map', () => {
    // Migration: existing bookmarks carry no icon fields and must not throw.
    expect(parseBookmarkIcons(undefined)).toEqual({})
    expect(parseBookmarkIcons(null)).toEqual({})
    expect(parseBookmarkIcons([{ id: 'custom-1', title: 'Old', url: 'https://a.test' }])).toEqual(
      {},
    )
  })
})

describe('setBookmarkIcon', () => {
  test('merges a patch without touching other bookmarks', () => {
    const before = { a: { emoji: '🚀' }, b: { faviconFile: 'x.png' } }
    const after = setBookmarkIcon(before, 'a', { faviconFile: 'y.png' })
    expect(after).toEqual({ a: { emoji: '🚀', faviconFile: 'y.png' }, b: { faviconFile: 'x.png' } })
    expect(before).toEqual({ a: { emoji: '🚀' }, b: { faviconFile: 'x.png' } })
  })

  test('clearing the emoji resets to the favicon rather than stranding a key', () => {
    const after = setBookmarkIcon({ a: { emoji: '🚀', faviconFile: 'y.png' } }, 'a', { emoji: '' })
    expect(after).toEqual({ a: { faviconFile: 'y.png' } })
  })

  test('an entry with nothing left is removed entirely', () => {
    expect(setBookmarkIcon({ a: { emoji: '🚀' } }, 'a', { emoji: '' })).toEqual({})
  })
})

describe('resolveBookmarkIcon precedence', () => {
  test('custom emoji beats everything', () => {
    expect(
      resolveBookmarkIcon({
        entry: { emoji: '🚀', faviconFile: 'x.png' },
        logo: 'asset.png',
        faviconSrc: 'data:image/png;base64,AAA',
      }),
    ).toEqual({ kind: 'emoji', emoji: '🚀' })
  })

  test('a cached favicon beats the bundled preset logo', () => {
    expect(
      resolveBookmarkIcon({
        entry: { faviconFile: 'x.png' },
        logo: 'asset.png',
        faviconSrc: 'data:image/png;base64,AAA',
      }),
    ).toEqual({ kind: 'image', src: 'data:image/png;base64,AAA' })
  })

  test('a cached file whose bytes are not loaded yet falls back, never to a blank tile', () => {
    expect(resolveBookmarkIcon({ entry: { faviconFile: 'x.png' }, logo: 'asset.png' })).toEqual({
      kind: 'image',
      src: 'asset.png',
    })
    expect(resolveBookmarkIcon({ entry: { faviconFile: 'x.png' } })).toEqual({ kind: 'globe' })
  })

  test('no icon at all is the globe', () => {
    expect(resolveBookmarkIcon({})).toEqual({ kind: 'globe' })
  })
})
