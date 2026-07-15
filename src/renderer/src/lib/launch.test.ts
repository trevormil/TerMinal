import { expect, test } from 'bun:test'
import { shouldDropToShellOnExit } from './launch'

test('local engine session drops to a shell on exit', () => {
  expect(shouldDropToShellOnExit({ isRemote: false, isLocalShell: false })).toBe(true)
})

test('a shell we already dropped to ends normally — no loop', () => {
  expect(shouldDropToShellOnExit({ isRemote: false, isLocalShell: true })).toBe(false)
})

test('remote session ends normally — a local shell would be the wrong host', () => {
  expect(shouldDropToShellOnExit({ isRemote: true, isLocalShell: false })).toBe(false)
  expect(shouldDropToShellOnExit({ isRemote: true, isLocalShell: true })).toBe(false)
})
