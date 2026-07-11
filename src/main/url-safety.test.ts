import { test, expect, describe } from 'bun:test'
import { isExternallyOpenableUrl } from './url-safety'

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
