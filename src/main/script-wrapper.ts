// Shared argv for the `script(1)` pseudo-TTY wrapper used to spawn engine CLIs
// so they think they're on a TTY and stream output live.
//
// macOS/BSD and util-linux take DIFFERENT forms. The in-process agent runner
// (agents.ts) uses this; the headless cron runner (bin/terminal-cron) keeps its
// own inline copy because it must stay a zero-app-import standalone Bun script.
// Centralizing the branch here (with a test) stops agents.ts from silently
// regressing on Linux the way it had.

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

/**
 * Build the argv for `spawn('script', <args>)` that wraps `<shell> -l -c <cmd>`.
 *
 * - macOS/BSD: `script -q /dev/null <cmd...>` — the command is trailing argv and
 *   `script` exits with the command's status.
 * - util-linux (Linux): needs `-c "<cmd>"` and, crucially, `-e`/`--return` to
 *   propagate the child's exit code. WITHOUT `-e`, Linux `script` always exits 0
 *   — so every run, including failures, would be recorded as done.
 */
export function scriptWrapperArgs(
  shell: string,
  cmd: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === 'darwin'
    ? ['-q', '/dev/null', shell, '-l', '-c', cmd]
    : ['-q', '-e', '-c', `${shq(shell)} -l -c ${shq(cmd)}`, '/dev/null']
}
