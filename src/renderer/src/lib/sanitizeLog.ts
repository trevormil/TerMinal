// Sanitize raw PTY / CI log output for display in <pre>.
//
// What gets cleaned:
//   - ANSI CSI sequences (color codes, cursor moves): ESC [ ... letter
//   - ANSI OSC sequences (window-title etc):         ESC ] ... BEL | ESC \
//   - Other ANSI escapes (single-char):              ESC =, ESC >, ESC N…
//   - Carriage returns used as line overwrites (progress bars): each \r in a
//     line collapses the line to whatever follows the last \r, so a progress
//     bar reads as just its final state instead of stacked redraws.
//   - Other C0 control characters (NUL, ^D/EOT, ^G/BEL, DEL …) are removed;
//     TAB (0x09) and LF (0x0A) are preserved.

const CSI = /\x1b\[[0-9;?]*[a-zA-Z]/g
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
// Single-char and 2-char ANSI escapes we sometimes see in PTY output:
// ESC = / ESC > (keypad), ESC NOP / ESC M (cursor), ESC (B (charset designation).
const MISC_ESC = /\x1b(?:[=>NOPM78c]|\([AB012])/g

function collapseCarriageReturns(s: string): string {
  if (!s.includes('\r')) return s
  const normalized = s.replace(/\r\n/g, '\n')
  if (!normalized.includes('\r')) return normalized
  // Process line-by-line so an overwrite is bounded to its own line.
  return normalized
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line
      const parts = line.split('\r')
      // Keep the final segment — that's what the terminal would have shown
      // after all the overwrites land.
      return parts[parts.length - 1]
    })
    .join('\n')
}

// Strip remaining C0 control chars except TAB and LF (CR is already handled).
const C0_REMAINDER = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g
// Some TTY wrappers print control characters in caret notation, for example
// "^D" for EOT. Strip those display artifacts too.
const CARET_CONTROL = /\^[A-Z\\[\]^_?]/g

export function sanitizeLog(s: string): string {
  if (!s) return ''
  return collapseCarriageReturns(s.replace(CSI, '').replace(OSC, '').replace(MISC_ESC, ''))
    .replace(CARET_CONTROL, '')
    .replace(C0_REMAINDER, '')
}
