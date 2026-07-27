import { describe, expect, test } from 'bun:test'
import { mergeLineRanges, parseUnifiedRanges } from './diff-ranges'

describe('mergeLineRanges', () => {
  test('coalesces overlapping and adjacent ranges, sorted', () => {
    expect(
      mergeLineRanges([
        { from: 10, to: 12 },
        { from: 1, to: 2 },
        { from: 3, to: 5 },
        { from: 11, to: 15 },
      ]),
    ).toEqual([
      { from: 1, to: 5 },
      { from: 10, to: 15 },
    ])
  })
  test('leaves disjoint ranges alone', () => {
    expect(
      mergeLineRanges([
        { from: 1, to: 1 },
        { from: 5, to: 6 },
      ]),
    ).toEqual([
      { from: 1, to: 1 },
      { from: 5, to: 6 },
    ])
  })
})

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,2 +10,3 @@ function x() {
-old
-old2
+new
+new2
+new3
@@ -40 +41 @@
-x
+y
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-a
diff --git a/fresh.ts b/fresh.ts
new file mode 100644
--- /dev/null
+++ b/fresh.ts
@@ -0,0 +1,2 @@
+hello
+world
`

describe('parseUnifiedRanges', () => {
  test('maps hunks to new-version line ranges per file', () => {
    expect(parseUnifiedRanges(DIFF)).toEqual({
      'src/a.ts': [
        { from: 10, to: 12 },
        { from: 41, to: 41 },
      ],
      'fresh.ts': [{ from: 1, to: 2 }],
    })
  })

  test('pure deletions attribute nothing', () => {
    expect(parseUnifiedRanges(DIFF)['gone.ts']).toBeUndefined()
  })

  test('empty diff parses to empty map', () => {
    expect(parseUnifiedRanges('')).toEqual({})
  })
})
