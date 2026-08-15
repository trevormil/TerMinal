import { test, expect, describe } from 'bun:test'
import { isExternallyOpenableUrl, isHttpUrl } from './url-safety'

describe('isExternallyOpenableUrl', () => {
  test('allows web + mail schemes', () => {
    expect(isExternallyOpenableUrl('https://example.com')).toBe(true)
    expect(isExternallyOpenableUrl('http://localhost:3000/x')).toBe(true)
    expect(isExternallyOpenableUrl('mailto:a@b.com')).toBe(true)
  })

  test('refuses local-file and custom schemes that openExternal would hand to the OS', () => {
    expect(isExternallyOpenableUrl('file:///etc/passwd')).toBe(false)
    expect(isExternallyOpenableUrl('smb://server/share')).toBe(false)
    expect(isExternallyOpenableUrl('vscode://file/tmp/x')).toBe(false)
    expect(isExternallyOpenableUrl('javascript:alert(1)')).toBe(false)
  })

  test('refuses non-strings and unparseable values', () => {
    expect(isExternallyOpenableUrl('')).toBe(false)
    expect(isExternallyOpenableUrl('not a url')).toBe(false)
    expect(isExternallyOpenableUrl(undefined)).toBe(false)
    expect(isExternallyOpenableUrl(42)).toBe(false)
  })
})

describe('isHttpUrl', () => {
  test('allows only http(s) — the schemes safe as an iframe src', () => {
    expect(isHttpUrl('https://dash.example/d/1')).toBe(true)
    expect(isHttpUrl('http://localhost:8787')).toBe(true)
  })

  test('refuses the schemes that would run in / read from the app origin', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpUrl('mailto:a@b.com')).toBe(false)
    expect(isHttpUrl(undefined)).toBe(false)
    expect(isHttpUrl('/relative/path')).toBe(false)
  })
})
