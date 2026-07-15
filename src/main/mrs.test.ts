import { test, expect, describe, mock, beforeEach } from 'bun:test'

mock.module('electron', () => ({
  Notification: class {
    static isSupported() {
      return false
    }
    show() {}
  },
}))

const detailRaw = mock(async () => ({
  iid: 12,
  title: 't',
  state: 'opened',
  author: 'a',
  webUrl: '',
  sourceBranch: 'feat',
  draft: false,
  headShort: 'headsha',
  baseShort: 'basesha',
  labels: [],
  description: '',
  targetBranch: 'main',
}))
const difftOnPath = mock(async (): Promise<boolean> => true)
const fileContent = mock(
  async (_repoRoot: string, _path: string, ref: string): Promise<string | null> =>
    ref === 'basesha' ? 'old content\n' : 'new content\n',
)
const runDifft = mock(async (): Promise<{ ok: boolean; output: string; error?: string }> => ({
  ok: true,
  output: '\x1b[32mstructural diff output\x1b[0m',
}))

mock.module('./forge', () => ({
  detailRaw,
  difftOnPath,
  fileContent,
  runDifft,
}))

const { getStructuralDiff } = await import('./mrs')

describe('getStructuralDiff', () => {
  beforeEach(() => {
    detailRaw.mockClear()
    difftOnPath.mockClear()
    fileContent.mockClear()
    runDifft.mockClear()
  })

  test('difft not on PATH → difft-missing, no further calls', async () => {
    difftOnPath.mockImplementationOnce(async () => false)
    const res = await getStructuralDiff('/repo', 12, 'src/a.ts')
    expect(res).toEqual({ ok: false, reason: 'difft-missing' })
    expect(detailRaw).not.toHaveBeenCalled()
  })

  test('happy path returns difft ANSI output', async () => {
    const res = await getStructuralDiff('/repo', 12, `src/a-${Math.random()}.ts`)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.output).toContain('structural diff output')
    expect(fileContent).toHaveBeenCalledTimes(2)
    expect(runDifft).toHaveBeenCalledTimes(1)
  })

  test('both sides fail to fetch → fetch-failed', async () => {
    fileContent.mockImplementationOnce(async () => null).mockImplementationOnce(async () => null)
    const res = await getStructuralDiff('/repo', 12, `src/missing-${Math.random()}.ts`)
    expect(res).toEqual({ ok: false, reason: 'fetch-failed' })
  })

  test('binary content (NUL byte) → binary', async () => {
    fileContent
      .mockImplementationOnce(async () => 'old\x00binary')
      .mockImplementationOnce(async () => 'new content\n')
    const res = await getStructuralDiff('/repo', 12, `src/bin-${Math.random()}.ts`)
    expect(res).toEqual({ ok: false, reason: 'binary' })
  })

  test('caches result per (iid, path, headShort)', async () => {
    const path = `src/cache-me-${Math.random()}.ts`
    const first = await getStructuralDiff('/repo', 12, path)
    const second = await getStructuralDiff('/repo', 12, path)
    expect(first).toEqual(second)
    // detailRaw + fileContent only invoked once across both calls (second call hit cache)
    expect(fileContent).toHaveBeenCalledTimes(2)
  })

  test('difft failure surfaces as error reason', async () => {
    runDifft.mockImplementationOnce(async () => ({
      ok: false,
      output: '',
      error: 'difft not found on PATH',
    }))
    const res = await getStructuralDiff('/repo', 12, `src/err-${Math.random()}.ts`)
    expect(res).toEqual({ ok: false, reason: 'error', message: 'difft not found on PATH' })
  })
})
