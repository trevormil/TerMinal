import { TemplateInsert } from './TemplateInsert'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { normalizeKnowledgePath } from '../../../../shared/knowledge-path'
import type { KnowledgeBase } from '../../lib/types'

export function PathNotes({
  repoRoot,
  initialPath,
  request,
}: {
  repoRoot: string
  initialPath: string
  request: number
}) {
  const [input, setInput] = useState(initialPath)
  const [path, setPath] = useState(normalizeKnowledgePath(initialPath) || '')
  const [kb, setKb] = useState<KnowledgeBase | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const appliedRequest = useRef(request)
  useEffect(() => {
    if (request === appliedRequest.current || dirty || busy) return
    appliedRequest.current = request
    setInput(initialPath)
    setPath(normalizeKnowledgePath(initialPath) || '')
  }, [initialPath, request, dirty, busy])
  useEffect(() => {
    setKb(null)
    setContent('')
    setMessage('')
    if (!repoRoot || !path) return
    let alive = true
    window.gt.knowledge
      .read({ path, repoRoot })
      .then((next) => {
        if (!alive) return
        setKb(next)
        setContent(next.items.find((item) => item.id === 'path-note')?.content || '')
      })
      .catch(() => alive && setMessage('Could not load this note.'))
    return () => {
      alive = false
    }
  }, [repoRoot, path])
  const open = () => {
    const next = normalizeKnowledgePath(input)
    if (!next) {
      setMessage('Enter a repo-relative file or folder path without ..')
      return
    }
    setPath(next)
  }
  const save = async () => {
    if (!kb || busy) return
    setBusy(true)
    const previous = kb.items.find((item) => item.id === 'path-note')
    const next: KnowledgeBase = {
      ...kb,
      items: [
        ...kb.items.filter((item) => item.id !== 'path-note'),
        {
          id: 'path-note',
          title: path,
          categoryId: kb.categories[0].id,
          kind: 'markdown',
          content,
          tags: [],
          createdAt: previous?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }
    try {
      const ok = await window.gt.knowledge.write({ path, repoRoot }, next)
      setMessage(ok ? 'Saved locally.' : 'Save failed. Your text is still here; try again.')
      if (ok) {
        setKb(next)
        setDirty(false)
      }
    } catch {
      setMessage('Save failed. Your text is still here; try again.')
    } finally {
      setBusy(false)
    }
  }
  if (!repoRoot)
    return (
      <p className="p-4 text-sm text-zinc-400">
        Open a local git repo to use file and folder notes.
      </p>
    )
  return (
    <section aria-label="Path notes" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <p className="text-xs text-zinc-400">
        Personal notes for an exact file or folder path. Repo and global notes stay separate. Save
        before leaving Notes or closing the session; notes remain at their original path after a
        rename.
      </p>
      <div className="flex gap-2">
        <input
          aria-label="Note path"
          placeholder="src or src/main/index.ts"
          value={input}
          disabled={dirty || busy}
          onChange={(e) => setInput(e.target.value)}
          className="min-w-0 flex-1 rounded border border-[var(--gt-border)] bg-transparent px-2 text-sm"
        />
        <Button size="sm" disabled={dirty || busy} onClick={open}>
          Open path
        </Button>
      </div>
      {path && (
        <p className="break-all font-mono text-xs">
          {repoRoot}/{path}
        </p>
      )}
      {kb ? (
        <>
          <TemplateInsert
            value={content}
            disabled={busy}
            onChange={(value) => {
              setContent(value)
              setDirty(true)
              setMessage('Unsaved changes')
            }}
          />
          <textarea
            aria-label="Path note content"
            value={content}
            disabled={busy}
            onChange={(e) => {
              setContent(e.target.value)
              setDirty(true)
              setMessage('Unsaved changes')
            }}
            className="min-h-32 flex-1 resize-none rounded border border-[var(--gt-border)] bg-transparent p-3 font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save note'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty || busy}
              onClick={() => {
                setContent(kb.items.find((item) => item.id === 'path-note')?.content || '')
                setDirty(false)
                setMessage('Changes discarded.')
              }}
            >
              Discard changes
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-zinc-400">
          {path ? 'Loading note…' : 'Choose a path here or use File notes / Folder notes in Files.'}
        </p>
      )}
      <p role="status" className="text-xs text-zinc-400">
        {message}
      </p>
    </section>
  )
}
