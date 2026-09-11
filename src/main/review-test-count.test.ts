import { expect, test } from 'bun:test'
import { recordedFailCount } from './review-test-count'
test('reads canonical test gate counts, including zero', () => {
  expect(recordedFailCount('## Test gate\n\n- pass: 12\n- fail: 3\n- exit code: 1')).toBe(3)
  expect(recordedFailCount('## Test gate\n- fail: 0')).toBe(0)
})
test('unknown counts and unrelated failures stay unknown', () => {
  for (const body of [
    '',
    '## Findings\n- fail: 3',
    '## Test gate\n- fail: unknown',
    '## Test gate\n- fail: -1',
    '## Test gate\n- fail: 1.5',
    '## Test gate\n## Findings\n- fail: 9',
  ])
    expect(recordedFailCount(body)).toBeNull()
})

test('canonical frontmatter count wins over legacy body and ignores other sections', () => {
  expect(
    recordedFailCount(
      '---\ntest_counts:\n  passed: 8\n  failed: 2\n  total: 10\n---\n## Test gate\n- fail: 7',
    ),
  ).toBe(2)
  expect(recordedFailCount('---\ntest_counts:\n  failed: 0\n---')).toBe(0)
  expect(recordedFailCount('---\nscores:\n  failed: 5\n---')).toBeNull()
})
