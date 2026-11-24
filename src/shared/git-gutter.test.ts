import { expect, test } from 'bun:test'
import { gitGutterLines } from './git-gutter'

test('marks additions and replacements, excluding context and patch headers', () => {
  expect(
    gitGutterLines('--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n same\n-old\n+new\n+extra\n tail', 4),
  ).toEqual([
    { line: 2, kind: 'modified' },
    { line: 3, kind: 'added' },
  ])
})
test('anchors deletions to a surviving line, including start and EOF', () => {
  expect(gitGutterLines('@@ -1 +0,0 @@\n-old', 1)).toEqual([{ line: 1, kind: 'deleted' }])
  expect(gitGutterLines('@@ -3,2 +3 @@\n keep\n-old', 3)).toEqual([{ line: 3, kind: 'deleted' }])
})
test('handles separate hunks, no-newline annotations, and bounds', () => {
  expect(
    gitGutterLines(
      '@@ -0,0 +1 @@\n+new\n\\ No newline at end of file\n@@ -9 +10 @@\n-old\n+new',
      2,
    ),
  ).toEqual([{ line: 1, kind: 'added' }])
  expect(gitGutterLines('Binary files differ', 3)).toEqual([])
})
