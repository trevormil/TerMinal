import { describe, expect, test } from 'bun:test'
import { extractSymbols } from './symbols'

const names = (path: string, src: string) => extractSymbols(path, src).map((s) => s.name)

describe('extractSymbols — TypeScript/JavaScript', () => {
  test('finds functions, classes, types, and arrow consts', () => {
    const src = [
      'export function alpha() {}',
      'class Beta {}',
      'export type Gamma = { a: 1 }',
      'export interface Delta { b: 2 }',
      'export const epsilon = (x: number) => x',
      'const zeta = async function () {}',
    ].join('\n')
    expect(names('a.ts', src)).toEqual(['alpha', 'Beta', 'Gamma', 'Delta', 'epsilon', 'zeta'])
  })

  test('reports 1-based line numbers that match the editor', () => {
    const syms = extractSymbols('a.ts', 'const x = 1\n\nfunction target() {}')
    expect(syms.find((s) => s.name === 'target')?.line).toBe(3)
  })

  test('distinguishes a plain const from a callable one', () => {
    const syms = extractSymbols('a.ts', 'const NAME = "x"\nconst fn = () => 1')
    expect(syms.find((s) => s.name === 'NAME')?.kind).toBe('const')
    expect(syms.find((s) => s.name === 'fn')?.kind).toBe('function')
  })

  test('picks up test blocks by their description', () => {
    const src = "describe('the thing', () => {\n  test('does something', () => {})\n})"
    expect(names('a.test.ts', src)).toEqual(['the thing', 'does something'])
  })

  test('ignores commented-out declarations', () => {
    const src = [
      '// function ghost() {}',
      '/*',
      'function alsoGhost() {}',
      '*/',
      'function real() {}',
    ].join('\n')
    expect(names('a.ts', src)).toEqual(['real'])
  })

  test('does not report control-flow keywords as methods', () => {
    const src = 'class A {\n  if (x) {\n  }\n  realMethod(a: number): void {\n  }\n}'
    expect(names('a.ts', src)).not.toContain('if')
    expect(names('a.ts', src)).toContain('realMethod')
  })
})

describe('extractSymbols — other languages', () => {
  test('python defs and classes', () => {
    expect(names('a.py', 'class Foo:\n    def bar(self):\n        pass')).toEqual(['Foo', 'bar'])
  })
  test('go funcs (including methods with receivers) and types', () => {
    expect(names('a.go', 'func Alpha() {}\nfunc (s *S) Beta() {}\ntype Gamma struct{}')).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ])
  })
  test('rust fns, types, and impls', () => {
    expect(names('a.rs', 'pub fn alpha() {}\nstruct Beta;\nimpl Beta {}')).toEqual([
      'alpha',
      'Beta',
      'Beta',
    ])
  })
  test('shell functions', () => {
    expect(names('a.sh', 'deploy() {\n  echo hi\n}')).toEqual(['deploy'])
  })
})

describe('extractSymbols — markdown outline', () => {
  test('headings become the outline, with depth', () => {
    const syms = extractSymbols('a.md', '# Title\n\n## Section\n\n### Sub')
    expect(syms.map((s) => [s.name, s.depth])).toEqual([
      ['Title', 0],
      ['Section', 1],
      ['Sub', 2],
    ])
    expect(syms.every((s) => s.kind === 'heading')).toBe(true)
  })

  test('a "#" inside a fenced code block is not a heading', () => {
    const src = '# Real\n\n```sh\n# just a shell comment\n```\n\n## Also real'
    expect(names('a.md', src)).toEqual(['Real', 'Also real'])
  })
})

describe('extractSymbols — honest failure', () => {
  test('an unsupported language yields nothing rather than nonsense', () => {
    expect(extractSymbols('a.zzz', 'function alpha() {}')).toEqual([])
  })
  test('empty input is safe', () => {
    expect(extractSymbols('a.ts', '')).toEqual([])
  })
})
