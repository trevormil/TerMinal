import { describe, expect, test } from 'bun:test'
import { inferActivityKind, resolveActivityKind } from './event-classifier'

describe('activity event classifier', () => {
  test('infers deploy and shipped titles', () => {
    expect(inferActivityKind('Deploy production')).toBe('deploy')
    expect(inferActivityKind('Shipped v1.2.3')).toBe('deploy')
    expect(inferActivityKind('Released staging build')).toBe('deploy')
  })

  test('honors explicit deploy kind passthrough', () => {
    expect(resolveActivityKind('deploy', 'anything')).toBe('deploy')
  })
})
