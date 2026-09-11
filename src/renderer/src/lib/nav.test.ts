import { afterEach, beforeEach, expect, test } from 'bun:test'
import { navigateTo, onNavigate, type NavEvent } from './nav'

const original = globalThis.window
beforeEach(() => {
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis
})
afterEach(() => {
  globalThis.window = original
})

test('file navigation survives a cold tab mount and is consumed only once', () => {
  navigateTo('files', { path: 'src/My File.ts', line: 42 })
  const seen: NavEvent[] = []
  const off = onNavigate((event) => seen.push(event), 'files')
  expect(seen).toEqual([{ tabId: 'files', payload: { path: 'src/My File.ts', line: 42 } }])
  off()
  const stop = onNavigate((event) => seen.push(event), 'files')
  expect(seen).toHaveLength(1)
  stop()
})

test('a mounted file tab gets each request once and newer destinations cancel stale requests', () => {
  const seen: NavEvent[] = []
  const off = onNavigate((event) => seen.push(event), 'files')
  navigateTo('files', { path: 'one.ts' })
  expect(seen).toHaveLength(1)
  off()
  navigateTo('files', { path: 'stale.ts' })
  navigateTo('terminal')
  const stop = onNavigate((event) => seen.push(event), 'files')
  expect(seen).toHaveLength(1)
  stop()
})
