import { watch, type FSWatcher } from 'node:fs'
import { sep } from 'node:path'

// One native fs.watch per workspace root, recursive — supported on macOS
// (this is a macOS-only Electron app) without a chokidar dependency. Ref-
// counted so multiple sessions attached to the same root share one watcher.
// Events are debounced and batched per root so a `git checkout` or an agent's
// multi-file edit doesn't flood the renderer with individual IPC messages.
const watchers = new Map<string, { watcher: FSWatcher; refs: number }>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Map<string, Set<string>>()
const DEBOUNCE_MS = 300

export function watchRoot(root: string, onChange: (root: string, paths: string[]) => void): void {
  if (!root) return
  const existing = watchers.get(root)
  if (existing) {
    existing.refs++
    return
  }
  try {
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const rel = filename.toString()
      // .git's own churn (index, HEAD, refs, lock files) isn't a workspace
      // content change worth refreshing the tree/editor for.
      if (rel.split(sep)[0] === '.git') return
      let set = pending.get(root)
      if (!set) pending.set(root, (set = new Set()))
      set.add(rel)
      clearTimeout(timers.get(root))
      timers.set(
        root,
        setTimeout(() => {
          const paths = Array.from(pending.get(root) || [])
          pending.delete(root)
          timers.delete(root)
          if (paths.length) onChange(root, paths)
        }, DEBOUNCE_MS),
      )
    })
    watcher.on('error', () => unwatchRoot(root))
    watchers.set(root, { watcher, refs: 1 })
  } catch {
    // fs.watch can throw (root missing, OS refuses recursive watch, etc.) —
    // auto-refresh just won't fire for this root; nothing else depends on it.
  }
}

export function unwatchRoot(root: string): void {
  const existing = watchers.get(root)
  if (!existing) return
  existing.refs--
  if (existing.refs > 0) return
  existing.watcher.close()
  watchers.delete(root)
  clearTimeout(timers.get(root))
  timers.delete(root)
  pending.delete(root)
}
