import { test, expect, describe } from 'bun:test'
import {
  forgeKindForHost,
  forgeMeta,
  forgeErrorReason,
  ghToRaw,
  glabToRaw,
  parseList,
  ghBucketToStatus,
  overallStatus,
  parseGhFileContent,
  parseGlabFileContent,
} from './forge'

describe('forgeKindForHost', () => {
  test('github.com (+ subdomains) → github when auto', () => {
    expect(forgeKindForHost('github.com', 'auto')).toBe('github')
    expect(forgeKindForHost('gist.github.com', 'auto')).toBe('github')
  })
  test('anything else → gitlab when auto', () => {
    expect(forgeKindForHost('gitlab.example.com', 'auto')).toBe('gitlab')
    expect(forgeKindForHost('gitlab.com', 'auto')).toBe('gitlab')
    expect(forgeKindForHost('', 'auto')).toBe('gitlab')
  })
  test('explicit pref overrides the host', () => {
    expect(forgeKindForHost('github.com', 'gitlab')).toBe('gitlab')
    expect(forgeKindForHost('gitlab.example.com', 'github')).toBe('github')
  })
  test('does not match lookalike hosts', () => {
    expect(forgeKindForHost('notgithub.com', 'auto')).toBe('gitlab')
    expect(forgeKindForHost('github.com.evil.com', 'auto')).toBe('gitlab')
  })
})

describe('forgeMeta', () => {
  test('github → gh / PR / #', () => {
    expect(forgeMeta('github')).toEqual({ kind: 'github', cli: 'gh', label: 'PR', sym: '#' })
  })
  test('gitlab → glab / MR / !', () => {
    expect(forgeMeta('gitlab')).toEqual({ kind: 'gitlab', cli: 'glab', label: 'MR', sym: '!' })
  })
})

describe('forgeErrorReason', () => {
  test('no error → undefined', () => {
    expect(forgeErrorReason('gh', null)).toBeUndefined()
  })
  test('ENOENT → not found', () => {
    const e = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
    expect(forgeErrorReason('gh', e)).toBe('gh not found on PATH')
  })
  test('auth phrasing → not authenticated', () => {
    expect(forgeErrorReason('glab', new Error('x'), 'HTTP 401 Unauthorized')).toBe(
      'glab not authenticated for this host',
    )
    expect(forgeErrorReason('gh', new Error('gh auth login required'))).toBe(
      'gh not authenticated for this host',
    )
  })
  test('other → first stderr line', () => {
    expect(forgeErrorReason('gh', new Error('boom'), 'could not resolve host\nmore')).toBe(
      'could not resolve host',
    )
  })
})

describe('ghToRaw', () => {
  test('maps gh JSON (camelCase) to the normalized shape', () => {
    const raw = ghToRaw({
      number: 12,
      title: 'Add thing',
      state: 'OPEN',
      author: { login: 'octocat' },
      url: 'https://github.com/o/r/pull/12',
      headRefName: 'feat/thing',
      isDraft: true,
      headRefOid: 'abcdef1234567890',
    })
    expect(raw).toEqual({
      iid: 12,
      title: 'Add thing',
      state: 'opened', // OPEN → opened
      author: 'octocat',
      webUrl: 'https://github.com/o/r/pull/12',
      sourceBranch: 'feat/thing',
      draft: true,
      headShort: 'abcdef1',
      labels: [],
    })
  })
})

describe('glabToRaw', () => {
  test('maps glab JSON (snake_case) to the normalized shape', () => {
    const raw = glabToRaw({
      iid: 7,
      title: 'Fix bug',
      state: 'opened',
      author: { username: 'trevor' },
      web_url: 'https://labs/x/-/merge_requests/7',
      source_branch: 'fix/bug',
      work_in_progress: true,
      sha: 'deadbeefcafe',
    })
    expect(raw).toEqual({
      iid: 7,
      title: 'Fix bug',
      state: 'opened',
      author: 'trevor',
      webUrl: 'https://labs/x/-/merge_requests/7',
      sourceBranch: 'fix/bug',
      draft: true,
      headShort: 'deadbee',
      labels: [],
    })
  })
})

describe('parseList', () => {
  test('parses gh array', () => {
    const out = parseList(
      'github',
      JSON.stringify([{ number: 1, state: 'OPEN', author: { login: 'a' } }]),
    )
    expect(out).toHaveLength(1)
    expect(out[0].iid).toBe(1)
    expect(out[0].state).toBe('opened')
  })
  test('garbage / non-array → []', () => {
    expect(parseList('github', 'not json')).toEqual([])
    expect(parseList('gitlab', '{"not":"array"}')).toEqual([])
  })
})

describe('ghBucketToStatus', () => {
  test('buckets map to gitlab-style statuses', () => {
    expect(ghBucketToStatus('pass')).toBe('success')
    expect(ghBucketToStatus('fail')).toBe('failed')
    expect(ghBucketToStatus('pending')).toBe('running')
    expect(ghBucketToStatus('skipping')).toBe('skipped')
    expect(ghBucketToStatus('cancel')).toBe('canceled')
  })
  test('falls back to state when bucket is unknown', () => {
    expect(ghBucketToStatus('', 'SUCCESS')).toBe('success')
    expect(ghBucketToStatus('', 'FAILURE')).toBe('failed')
    expect(ghBucketToStatus('', '')).toBe('pending')
  })
})

describe('parseGhFileContent', () => {
  test('decodes a base64 file-contents response', () => {
    const b64 = Buffer.from('hello world\n', 'utf8').toString('base64')
    const out = parseGhFileContent(JSON.stringify({ content: b64, encoding: 'base64' }))
    expect(out).toBe('hello world\n')
  })
  test('non-base64 encoding → null', () => {
    expect(parseGhFileContent(JSON.stringify({ content: 'x', encoding: 'utf-8' }))).toBeNull()
  })
  test('directory listing (array) → null', () => {
    expect(parseGhFileContent(JSON.stringify([{ name: 'a' }]))).toBeNull()
  })
  test('garbage → null', () => {
    expect(parseGhFileContent('not json')).toBeNull()
  })
})

describe('parseGlabFileContent', () => {
  test('decodes a base64 file-contents response', () => {
    const b64 = Buffer.from('fn main() {}\n', 'utf8').toString('base64')
    const out = parseGlabFileContent(JSON.stringify({ content: b64, encoding: 'base64' }))
    expect(out).toBe('fn main() {}\n')
  })
  test('missing content field → null', () => {
    expect(parseGlabFileContent(JSON.stringify({ encoding: 'base64' }))).toBeNull()
  })
  test('garbage → null', () => {
    expect(parseGlabFileContent('{bad')).toBeNull()
  })
})

describe('overallStatus', () => {
  test('any failure → failed', () => {
    expect(overallStatus(['success', 'failed', 'running'])).toBe('failed')
  })
  test('any running/pending (no fail) → running', () => {
    expect(overallStatus(['success', 'running'])).toBe('running')
    expect(overallStatus(['success', 'pending'])).toBe('running')
  })
  test('all terminal-good → success', () => {
    expect(overallStatus(['success', 'skipped', 'canceled'])).toBe('success')
  })
  test('empty → pending', () => {
    expect(overallStatus([])).toBe('pending')
  })
})
