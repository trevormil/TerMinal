import { describe, expect, test } from 'bun:test'
import { parseTabs } from './tabs'

// tabs.json is repo-controlled: a `url` tab's value lands directly in an iframe
// `src` inside the window that holds `window.gt`, so the scheme is validated in
// main rather than trusted from the file.
describe('parseTabs url validation', () => {
  const parse = (t: unknown) => parseTabs([t], 'repo', '/tmp/repo')

  test('keeps http(s) url tabs', () => {
    expect(parse({ title: 'Dash', url: 'http://localhost:8787' })[0]?.url).toBe(
      'http://localhost:8787',
    )
    expect(parse({ title: 'Graf', url: 'https://grafana.example/d/1' })[0]?.url).toBe(
      'https://grafana.example/d/1',
    )
  })

  test('drops a tab whose only source is a non-http scheme', () => {
    expect(parse({ title: 'Pwn', url: 'javascript:alert(1)' })).toEqual([])
    expect(parse({ title: 'Pwn', url: 'data:text/html,<script>x()</script>' })).toEqual([])
    expect(parse({ title: 'Pwn', url: 'file:///etc/passwd' })).toEqual([])
    expect(parse({ title: 'Pwn', url: 'vscode://file/tmp/x' })).toEqual([])
  })

  test('a bad url does not leak through on a tab that also has a command', () => {
    const [tab] = parse({ title: 'Mixed', url: 'javascript:alert(1)', command: 'echo hi' })
    expect(tab.url).toBeUndefined()
    expect(tab.command).toBe('echo hi')
  })

  test('command tabs and the rest of the shape are unchanged', () => {
    const [tab] = parse({ title: 'Status', command: 'echo hi', icon: 'gauge', intervalMs: 3000 })
    expect(tab).toMatchObject({
      title: 'Status',
      command: 'echo hi',
      icon: 'gauge',
      intervalMs: 3000,
      source: 'repo',
    })
    expect(tab.id.startsWith('custom:repo:')).toBe(true)
  })

  test('non-array and malformed entries are ignored', () => {
    expect(parseTabs(null, 'global')).toEqual([])
    expect(parseTabs([{ title: 'no source' }, null, 42], 'global')).toEqual([])
  })
})
