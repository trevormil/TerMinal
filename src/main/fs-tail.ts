import { closeSync, openSync, readSync, statSync } from 'node:fs'

// Agent/run logs grow without bound (tens of MB over a long run), and several
// callers only ever need the end of one — reading the whole file to .slice()
// the tail blocks the main process for the size of the log. Read just the
// last `maxBytes` instead. Throws like fs would on a missing file.

export function readFileTail(path: string, maxBytes: number): { text: string; size: number } {
  const size = statSync(path).size
  const len = Math.min(maxBytes, size)
  if (len <= 0) return { text: '', size }
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(len)
    const read = readSync(fd, buf, 0, len, size - len)
    return { text: buf.toString('utf8', 0, read), size }
  } finally {
    closeSync(fd)
  }
}
