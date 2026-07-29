import { describe, expect, test } from 'bun:test'
import { declutterTitle, declutterDetail } from './index'

describe('declutterTitle', () => {
  test('strips an exact "repo · " prefix that repeats the repo chip', () => {
    expect(
      declutterTitle('trevormil/knowledge-app · local · exited', 'trevormil/knowledge-app'),
    ).toBe('local · exited')
  })

  test('leaves the title untouched when there is no repo', () => {
    expect(declutterTitle('trevormil/foo · local · exited', undefined)).toBe(
      'trevormil/foo · local · exited',
    )
  })

  test('leaves the title untouched when it does not start with the repo prefix', () => {
    expect(
      declutterTitle(
        'knowledge-app — Ran the full path from edge to pod',
        'trevormil/knowledge-app',
      ),
    ).toBe('knowledge-app — Ran the full path from edge to pod')
  })
})

describe('declutterDetail', () => {
  test('strips a trailing path segment that repeats the repo basename', () => {
    expect(
      declutterDetail('exit 1 · ~/CompSci/gauntlet/knowledge-app', 'trevormil/knowledge-app'),
    ).toBe('exit 1')
  })

  test('drops the whole detail when it is only the repeated path', () => {
    expect(declutterDetail('~/CompSci/gauntlet/knowledge-app', 'trevormil/knowledge-app')).toBe('')
  })

  test('leaves unrelated detail text untouched', () => {
    expect(declutterDetail('Ran the full path from edge to pod', 'trevormil/knowledge-app')).toBe(
      'Ran the full path from edge to pod',
    )
  })

  test('leaves detail untouched when there is no repo', () => {
    expect(declutterDetail('exit 1 · ~/CompSci/gauntlet/knowledge-app', undefined)).toBe(
      'exit 1 · ~/CompSci/gauntlet/knowledge-app',
    )
  })
})
