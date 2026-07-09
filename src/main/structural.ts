// Structural (difft) diff primitive, shared by the forge MR path (mrs.ts) and
// the local working-tree path (repo.ts). Kept a leaf — imports only ./forge
// (electron-free) + node builtins — so both callers and their tests can use it
// without dragging in the electron/IPC surface.
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runDifft } from './forge'

export type StructuralDiffResult =
  | { ok: true; output: string }
  | { ok: false; reason: 'difft-missing' | 'binary' | 'fetch-failed' | 'error'; message?: string }

const NUL = String.fromCharCode(0)

// A NUL byte is the classic "not text" signal — difft chokes on binary decoded
// through UTF-8, so bail to the line-diff fallback instead.
export function looksBinary(content: string | null): boolean {
  return content !== null && content.includes(NUL)
}

// Run difft on two in-memory content blobs → structural result. Caching is the
// caller's job (keys differ: MR by headSha, local by working tree). A null side
// means the file is absent there (added/deleted) → an empty file to difft.
// Returns 'fetch-failed' when both sides are absent.
export async function structuralDiffFromContent(
  oldContent: string | null,
  newContent: string | null,
  width: number | undefined,
  tag: string,
): Promise<StructuralDiffResult> {
  if (oldContent === null && newContent === null) return { ok: false, reason: 'fetch-failed' }
  if (looksBinary(oldContent) || looksBinary(newContent)) return { ok: false, reason: 'binary' }
  const stamp = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const safe = tag.replace(/[\\/]/g, '_')
  const oldFile = join(tmpdir(), `difft-old-${stamp}-${safe}`)
  const newFile = join(tmpdir(), `difft-new-${stamp}-${safe}`)
  writeFileSync(oldFile, oldContent ?? '')
  writeFileSync(newFile, newContent ?? '')
  try {
    const r = await runDifft(oldFile, newFile, width)
    if (!r.ok) return { ok: false, reason: 'error', message: r.error }
    return { ok: true, output: r.output }
  } finally {
    try {
      unlinkSync(oldFile)
    } catch {
      /* best-effort cleanup */
    }
    try {
      unlinkSync(newFile)
    } catch {
      /* best-effort cleanup */
    }
  }
}
