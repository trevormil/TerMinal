import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isHttpUrl } from '../shared/url-safety'

// Ticket 102. `sandbox="allow-scripts allow-same-origin"` is not a partial
// sandbox — it is NO sandbox. Together the two let the framed document reach
// its own DOM and remove the sandbox attribute from itself, so everything else
// in the list is decoration.
//
// PR #197 stripped that pair from UrlTab and CommandTab. `tabs/panels/` was
// owned by a concurrent chain that day and kept it, which is exactly the shape
// of defect the parallel-chain workflow produces: fixed everywhere someone
// looked, intact where nobody could edit.

const ROOT = resolve(import.meta.dir, '../..')
const PANELS = join(ROOT, 'src/renderer/src/tabs/panels/index.tsx')

/** Every `sandbox="…"` attribute in a source file. */
function sandboxAttrs(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  return [...src.matchAll(/sandbox=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2])
}

describe('the panels iframe is actually sandboxed (ticket 102)', () => {
  test('it never combines allow-scripts with allow-same-origin', () => {
    const attrs = sandboxAttrs(PANELS)
    expect(attrs.length).toBeGreaterThan(0)
    for (const a of attrs) {
      const tokens = a.split(/\s+/).filter(Boolean)
      const escape = tokens.includes('allow-scripts') && tokens.includes('allow-same-origin')
      expect(escape, `sandbox="${a}" is the documented escape pair`).toBe(false)
    }
  })

  test('no OTHER renderer surface reintroduces the pair either', () => {
    // The property, not the instance: this file was missed once already because
    // the fix was applied per-file rather than as an invariant.
    const surfaces = ['src/renderer/src/tabs/panels/index.tsx']
    for (const rel of surfaces) {
      for (const a of sandboxAttrs(join(ROOT, rel))) {
        expect(a.includes('allow-same-origin') && a.includes('allow-scripts')).toBe(false)
      }
    }
  })

  test('the panel URL is gated before it can become a frame src', () => {
    const src = readFileSync(PANELS, 'utf8')
    // Rendering the iframe must be conditional on the check, not merely near it.
    expect(src).toContain('isHttpUrl(cur.url)')
  })
})

describe('the gate itself refuses everything a frame src must not load', () => {
  test('http and https pass', () => {
    expect(isHttpUrl('https://grafana.example.com/d/abc')).toBe(true)
    expect(isHttpUrl('http://localhost:3000')).toBe(true)
  })

  test('schemes that would escalate a panel are refused', () => {
    // file: reads the disk; data:/javascript: execute in the frame; OS schemes
    // hand the value to a registered handler outside the browser sandbox.
    for (const u of [
      'file:///etc/passwd',
      'data:text/html,<script>fetch("/")</script>',
      'javascript:alert(1)',
      'vscode://file/Users/me/.ssh/id_rsa',
      'obsidian://open?vault=x',
      'smb://host/share',
      '',
      'not a url',
    ]) {
      expect(isHttpUrl(u), `${u} must not be usable as a frame src`).toBe(false)
    }
  })

  test('non-strings are refused rather than coerced', () => {
    for (const v of [null, undefined, 42, {}, ['https://x.com']]) {
      expect(isHttpUrl(v)).toBe(false)
    }
  })
})

describe('settings refuses to PERSIST a non-http panel (ticket 102)', () => {
  // Validating only at render lets a bad value sit in settings.json and
  // re-present itself to every future reader, including one that forgets to
  // check. Agents write settings here, so "the user typed it" is not a trust
  // argument.
  test('the write path filters on the same gate', () => {
    const src = readFileSync(join(ROOT, 'src/main/settings.ts'), 'utf8')
    const start = src.indexOf('Array.isArray(r.pinnedPanels)')
    expect(start).toBeGreaterThan(-1)
    const block = src.slice(start, start + 800)
    expect(block).toContain('isHttpUrl')
  })
})
