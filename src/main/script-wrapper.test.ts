import { expect, test } from 'bun:test'
import { scriptWrapperArgs } from './script-wrapper'

test('macOS/BSD form takes the command as trailing argv', () => {
  expect(scriptWrapperArgs('/bin/zsh', 'claude -p hi', 'darwin')).toEqual([
    '-q',
    '/dev/null',
    '/bin/zsh',
    '-l',
    '-c',
    'claude -p hi',
  ])
})

test('Linux (util-linux) form includes -e and -c so exit codes propagate', () => {
  const args = scriptWrapperArgs('/bin/bash', 'codex exec x', 'linux')
  // Without -e, Linux `script` always exits 0 → failures record as done.
  expect(args).toContain('-e')
  expect(args).toContain('-c')
  // The command is quoted into the -c string, not passed as trailing argv.
  expect(args[args.indexOf('-c') + 1]).toBe(`'/bin/bash' -l -c 'codex exec x'`)
  // /dev/null is the trailing typescript file, not a positional command.
  expect(args[args.length - 1]).toBe('/dev/null')
})
