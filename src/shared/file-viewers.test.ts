import { describe, expect, test } from 'bun:test'
import {
  base64ToBytes,
  dataUrl,
  defaultsToSource,
  delimiterFor,
  hasSourceToggle,
  hexDump,
  humanSize,
  needsBinaryRead,
  parseDelimited,
  viewerKindFor,
} from './file-viewers'

describe('viewerKindFor', () => {
  test('routes each family to its viewer', () => {
    expect(viewerKindFor('README.md')).toBe('markdown')
    expect(viewerKindFor('a/b/notes.markdown')).toBe('markdown')
    expect(viewerKindFor('logo.png')).toBe('image')
    expect(viewerKindFor('shot.JPEG')).toBe('image') // case-insensitive
    expect(viewerKindFor('icon.svg')).toBe('svg') // its own kind: renders AND has source
    expect(viewerKindFor('paper.pdf')).toBe('pdf')
    expect(viewerKindFor('data.csv')).toBe('csv')
    expect(viewerKindFor('data.tsv')).toBe('csv')
    expect(viewerKindFor('pkg.json')).toBe('json')
    expect(viewerKindFor('app.ts')).toBe('text')
  })

  test('known-binary extensions get a hex dump, never text', () => {
    for (const p of ['a.zip', 'lib.dylib', 'db.sqlite3', 'font.woff2', 'clip.mp4'])
      expect(viewerKindFor(p)).toBe('binary')
  })

  test('dotfiles and extensionless files fall back to text', () => {
    expect(viewerKindFor('.gitignore')).toBe('text')
    expect(viewerKindFor('Makefile')).toBe('text')
    expect(viewerKindFor('bin/terminal-cli')).toBe('text')
  })
})

describe('viewer capabilities', () => {
  test('only image/pdf/binary need the binary read path', () => {
    expect(needsBinaryRead('image')).toBe(true)
    expect(needsBinaryRead('pdf')).toBe(true)
    expect(needsBinaryRead('binary')).toBe(true)
    expect(needsBinaryRead('markdown')).toBe(false)
    expect(needsBinaryRead('text')).toBe(false)
  })
  test('renderable-but-editable kinds expose a source toggle', () => {
    expect(hasSourceToggle('markdown')).toBe(true)
    expect(hasSourceToggle('csv')).toBe(true)
    expect(hasSourceToggle('svg')).toBe(true)
    // A raster image has no meaningful source view.
    expect(hasSourceToggle('image')).toBe(false)
    expect(hasSourceToggle('binary')).toBe(false)
  })
})

describe('dataUrl', () => {
  test('uses the right mime per extension', () => {
    expect(dataUrl('a.png', 'AAA')).toBe('data:image/png;base64,AAA')
    expect(dataUrl('a.svg', 'AAA')).toBe('data:image/svg+xml;base64,AAA')
    expect(dataUrl('a.pdf', 'AAA')).toBe('data:application/pdf;base64,AAA')
    expect(dataUrl('a.unknownext', 'AAA')).toBe('data:application/octet-stream;base64,AAA')
  })
})

describe('parseDelimited', () => {
  test('parses a simple CSV', () => {
    expect(parseDelimited('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })
  test('honours quoted fields containing the delimiter', () => {
    expect(parseDelimited('name,note\n"Smith, Jane",hi')).toEqual([
      ['name', 'note'],
      ['Smith, Jane', 'hi'],
    ])
  })
  test('honours escaped quotes and newlines inside quotes', () => {
    expect(parseDelimited('a\n"he said ""hi""\nsecond line"')).toEqual([
      ['a'],
      ['he said "hi"\nsecond line'],
    ])
  })
  test('a trailing newline does not invent an empty row', () => {
    expect(parseDelimited('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  test('empty cells are preserved (not collapsed)', () => {
    expect(parseDelimited('a,,c')).toEqual([['a', '', 'c']])
  })
  test('TSV uses a tab delimiter', () => {
    expect(delimiterFor('x.tsv')).toBe('\t')
    expect(delimiterFor('x.csv')).toBe(',')
    expect(parseDelimited('a\tb', '\t')).toEqual([['a', 'b']])
  })
  test('CRLF line endings are handled', () => {
    expect(parseDelimited('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('hexDump', () => {
  test('formats offset, 16 bytes of hex in two halves, and printable ASCII', () => {
    const bytes = new Uint8Array([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x01, 0x7f, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47,
      0x48,
    ])
    const [line] = hexDump(bytes)
    expect(line.offset).toBe('00000000')
    expect(line.hex).toBe('48 65 6c 6c 6f 00 01 7f  41 42 43 44 45 46 47 48')
    // Non-printables render as dots, so the column always lines up.
    expect(line.ascii).toBe('Hello...ABCDEFGH')
  })
  test('pads a short final line so columns stay aligned', () => {
    const [line] = hexDump(new Uint8Array([0x41, 0x42]))
    expect(line.ascii).toBe('AB')
    expect(line.hex.startsWith('41 42 ')).toBe(true)
    expect(line.hex).toHaveLength('48 65 6c 6c 6f 00 01 7f  41 42 43 44 45 46 47 48'.length)
  })
  test('caps output so a huge binary cannot lock the renderer', () => {
    const big = new Uint8Array(200_000)
    expect(hexDump(big, 1024)).toHaveLength(64) // 1024/16
  })
})

describe('base64ToBytes', () => {
  test('round-trips through the hex dump', () => {
    // "Hi" === SGk=
    expect(Array.from(base64ToBytes('SGk='))).toEqual([0x48, 0x69])
    expect(hexDump(base64ToBytes('SGk='))[0].ascii).toBe('Hi')
  })
})

describe('humanSize', () => {
  test('scales units', () => {
    expect(humanSize(512)).toBe('512 B')
    expect(humanSize(2048)).toBe('2.0 KB')
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('defaultsToSource', () => {
  test('text-backed viewers open in the editor, binary ones render', () => {
    // Clicking a file always lands in the EDITOR when the content is text —
    // markdown must not open as a preview. Rendered stays one toggle away.
    expect(defaultsToSource('markdown')).toBe(true)
    expect(defaultsToSource('csv')).toBe(true)
    expect(defaultsToSource('svg')).toBe(true)
    // No text behind these — the viewer is the only sane default.
    expect(defaultsToSource('image')).toBe(false)
    expect(defaultsToSource('pdf')).toBe(false)
    expect(defaultsToSource('binary')).toBe(false)
  })
})
