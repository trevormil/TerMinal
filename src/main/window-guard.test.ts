import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appCsp, isAppUrl, navigationDecision } from './window-guard'

const PROD = 'file:///Applications/TerMinal.app/Contents/Resources/app/out/renderer/index.html'
const DEV = 'http://localhost:5173/'

describe('isAppUrl', () => {
  test('packaged: only the app document matches', () => {
    expect(isAppUrl(PROD, PROD)).toBe(true)
    expect(isAppUrl('file:///Users/me/evil.html', PROD)).toBe(false)
    expect(isAppUrl('https://evil.example/index.html', PROD)).toBe(false)
  })

  test('dev: same origin matches, other ports/hosts do not', () => {
    expect(isAppUrl('http://localhost:5173/src/main.tsx', DEV)).toBe(true)
    expect(isAppUrl('http://localhost:8787/', DEV)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', DEV)).toBe(false)
  })

  test('a file: URL with a different host is not the app document', () => {
    // file://evil.example/…/index.html shares the pathname but not the host.
    expect(isAppUrl(PROD.replace('file:///', 'file://evil.example/'), PROD)).toBe(false)
  })

  test('non-URL input never matches', () => {
    expect(isAppUrl('', PROD)).toBe(false)
    expect(isAppUrl('not a url', PROD)).toBe(false)
  })
})

describe('navigationDecision', () => {
  test('blocks every main-frame navigation away from the app document', () => {
    expect(navigationDecision('https://evil.example/', PROD, true)).toBe('block')
    expect(navigationDecision('file:///Users/me/dropped.html', PROD, true)).toBe('block')
    // The classic drop-a-file escalation: a local page in the app origin.
    expect(navigationDecision('file:///tmp/pwn.html', DEV, true)).toBe('block')
  })

  test('allows the app navigating to itself (reload / in-app routing)', () => {
    expect(navigationDecision(PROD, PROD, true)).toBe('allow')
    expect(navigationDecision('http://localhost:5173/', DEV, true)).toBe('allow')
  })

  test('subframes may load http(s)/about/blob — url + command custom tabs', () => {
    expect(navigationDecision('http://localhost:8787/dash', PROD, false)).toBe('allow')
    expect(navigationDecision('https://grafana.example/d/1', PROD, false)).toBe('allow')
    expect(navigationDecision('about:srcdoc', PROD, false)).toBe('allow')
  })

  // Regression: `will-frame-navigate` fires on iframe src loads, and the Files
  // tab previews PDFs as a data: URL (FileViewer.tsx:336). Omitting data: here
  // silently blanked every PDF preview — and contradicted appCsp's frame-src,
  // which already allows it.
  test('subframes may load the data: URLs the Files tab previews PDFs with', () => {
    expect(navigationDecision('data:application/pdf;base64,JVBERi0xLjQK', PROD, false)).toBe(
      'allow',
    )
    // ...but never as a top-level navigation of the window that owns window.gt.
    expect(navigationDecision('data:text/html,<script>alert(1)</script>', PROD, true)).toBe('block')
  })

  test('every scheme the CSP frames is also allowed by the navigation guard', () => {
    const frameSrc = appCsp(false)
      .split('; ')
      .find((d) => d.startsWith('frame-src'))!
    for (const [scheme, sample] of [
      ['http:', 'http://x.example/'],
      ['https:', 'https://x.example/'],
      ['data:', 'data:text/plain,hi'],
      ['blob:', 'blob:https://x.example/1'],
    ] as const) {
      expect(frameSrc).toContain(scheme)
      expect(navigationDecision(sample, PROD, false)).toBe('allow')
    }
  })

  test('subframes may not load file:// or custom OS schemes', () => {
    expect(navigationDecision('file:///etc/passwd', PROD, false)).toBe('block')
    expect(navigationDecision('vscode://x', PROD, false)).toBe('block')
    expect(navigationDecision('javascript:alert(1)', PROD, false)).toBe('block')
  })
})

describe('appCsp', () => {
  test('remote script is never allowed into the app origin', () => {
    for (const csp of [appCsp(true), appCsp(false)]) {
      const script = csp.split('; ').find((d) => d.startsWith('script-src '))!
      expect(script).not.toContain('http:')
      expect(script).not.toContain('https:')
      expect(script).toContain("'self'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("base-uri 'self'")
    }
  })

  test('dev allows the vite HMR socket; packaged does not', () => {
    expect(appCsp(true)).toContain('ws://localhost:*')
    expect(appCsp(false)).not.toContain('ws://')
    expect(appCsp(false)).toContain("connect-src 'self'")
  })

  test('custom url tabs can still be framed', () => {
    expect(appCsp(false)).toContain('frame-src')
    expect(
      appCsp(false)
        .split('; ')
        .find((d) => d.startsWith('frame-src')),
    ).toContain('https:')
  })
})

// The header CSP (onHeadersReceived) may or may not apply to a `file://`
// document depending on the Electron version — which is precisely the packaged
// build. index.html therefore carries a meta CSP as an always-applies fallback.
// The two must not drift: a header stricter than the meta is fine (the
// intersection is enforced), but a meta that has silently fallen behind would
// leave the packaged build on a stale policy.
describe('index.html meta CSP fallback', () => {
  const html = readFileSync(join(import.meta.dir, '../renderer/index.html'), 'utf8')
  const meta = /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/.exec(html)?.[1]

  test('the fallback exists', () => {
    expect(meta).toBeTruthy()
  })

  test('it matches appCsp exactly, so the two cannot drift', () => {
    // The dev variant: the tag is static and must not break HMR, since the
    // intersection of meta and header is what the browser enforces.
    expect(meta).toBe(appCsp(true))
  })

  test('it still forbids remote script — the directive the whole guard is for', () => {
    const script = meta!.split('; ').find((d) => d.startsWith('script-src '))!
    expect(script).not.toContain('http:')
    expect(script).not.toContain('https:')
    expect(meta).toContain("object-src 'none'")
  })
})
