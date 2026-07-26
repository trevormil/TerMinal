import { describe, expect, test } from 'bun:test'
import { stickyLinesFor } from './sticky'

const js = `class A {
  method() {
    if (x) {
      deep()
      deeper()
    }
  }
  other() {
    y()
  }
}
function top() {
  z()
}`.split('\n')

describe('stickyLinesFor', () => {
  test('pins the enclosing class, method, and if for a deep line', () => {
    // line 5 = deeper() — enclosed by if(3) ← method(2) ← class(1)
    expect(stickyLinesFor(js, 5)).toEqual([1, 2, 3])
  })

  test('a line in the second method pins class + that method only', () => {
    // line 9 = y() inside other()
    expect(stickyLinesFor(js, 9)).toEqual([1, 8])
  })

  test('a top-level line pins nothing', () => {
    // line 12 is `function top() {` itself at column 0
    expect(stickyLinesFor(js, 12)).toEqual([])
  })

  test('a closed sibling scope above is not pinned', () => {
    // line 13 = z() inside top() — class A is long closed
    expect(stickyLinesFor(js, 13)).toEqual([12])
  })

  test('caps at max, keeping the innermost scopes', () => {
    expect(stickyLinesFor(js, 5, 2)).toEqual([2, 3])
  })

  test('python-style colon scopes work', () => {
    const py = `class A:
  def f(self):
    for x in y:
      body()`.split('\n')
    expect(stickyLinesFor(py, 4)).toEqual([1, 2, 3])
  })

  test('blank top lines anchor on the next non-blank line', () => {
    const src = `function f() {
  a()

  b()
}`.split('\n')
    // top = blank line 3; anchor = b() at indent 2 → f() pinned
    expect(stickyLinesFor(src, 3)).toEqual([1])
  })

  test('first line of the file pins nothing', () => {
    expect(stickyLinesFor(js, 1)).toEqual([])
  })
})
