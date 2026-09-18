import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { definitionSelection, localDefinitions, symbolAt } from './symbols'
import type { FileSymbolSearchResult } from '../../../../shared/local-symbols'

export function SymbolJump({
  getView,
  source,
  local,
  onOpen,
}: {
  getView: () => EditorView | undefined
  source: string
  local: boolean
  onOpen: (path: string, line: number) => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ReturnType<typeof localDefinitions> | null>(null)
  const [outline, setOutline] = useState(false)
  const [searching, setSearching] = useState(false)
  const [project, setProject] = useState<FileSymbolSearchResult | null>(null)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const search = (selection = false) => {
    const view = getView()
    if (!view) return
    const text = view.state.doc.toString()
    const name = selection ? symbolAt(text, view.state.selection.main.head) : query
    if (selection) setQuery(name)
    setHits(selection && !name ? [] : localDefinitions(text, name))
  }
  const jump = (hit: { name: string; line: number }) => {
    const view = getView()
    if (!view) return
    const selection = definitionSelection(view.state.doc.toString(), hit)
    if (!selection) {
      search()
      return
    }
    view.dispatch({ selection, scrollIntoView: true })
    view.focus()
  }
  const searchProject = async () => {
    const id = ++request.current
    setSearching(true)
    setProject(null)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        window.gt.files.symbols(query),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Search timed out. Try again.')), 12_000)
        }),
      ])
      if (request.current === id) setProject(result)
    } catch {
      if (request.current === id)
        setProject({
          hits: [],
          scanned: 0,
          skipped: 0,
          truncated: false,
          error: 'Symbol search failed or timed out. Try again.',
        })
    } finally {
      clearTimeout(timer)
      if (request.current === id) setSearching(false)
    }
  }
  const outlineHits = outline ? localDefinitions(source, '') : []
  return (
    <div className="border-b border-[var(--gt-border)] p-2 text-xs">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          search()
        }}
      >
        <input
          aria-label="Local symbol"
          placeholder="Symbol name (blank lists definitions)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent"
        />
        <button type="submit">Find symbol</button>
        <button type="button" onClick={() => search(true)}>
          Go to definition
        </button>
        {local && (
          <button type="button" disabled={searching} onClick={searchProject}>
            {searching ? 'Searching tracked files…' : 'Search tracked files'}
          </button>
        )}
        <button type="button" aria-pressed={outline} onClick={() => setOutline((v) => !v)}>
          Outline
        </button>
      </form>
      {hits && (
        <div role="status" className="max-h-28 overflow-auto pt-2 text-zinc-400">
          {hits.length
            ? hits.map((hit) => (
                <button key={hit.offset} className="mr-3 underline" onClick={() => jump(hit)}>
                  {hit.name}:{hit.line}
                </button>
              ))
            : 'No local definition found. Search uses common declarations in this file.'}
        </div>
      )}
      {searching && (
        <p role="status" className="pt-2">
          Searching tracked files…
        </p>
      )}
      {project && (
        <div aria-label="Tracked symbol results" className="max-h-32 overflow-auto pt-2">
          <p role={project.error ? 'alert' : 'status'} className="text-zinc-400">
            {project.error ||
              `${project.hits.length ? 'Declaration matches' : 'No tracked definition found'} · ${project.scanned} files scanned · ${project.skipped} skipped${project.truncated ? ' · Truncated by search limits' : ''}`}
          </p>
          {project.hits.map((hit) => (
            <button
              key={`${hit.path}:${hit.offset}`}
              className="block max-w-full truncate underline"
              onClick={() => onOpen(hit.path, hit.line)}
            >
              {hit.path}:{hit.line} — {hit.name}
            </button>
          ))}
        </div>
      )}
      {outline && (
        <nav
          aria-label="Current file outline"
          className="mt-2 max-h-40 overflow-auto border-t border-[var(--gt-border)] pt-2"
        >
          {outlineHits.length ? (
            outlineHits.map((hit) => (
              <button key={hit.offset} className="block underline" onClick={() => jump(hit)}>
                {hit.name}:{hit.line}
              </button>
            ))
          ) : (
            <p>No declarations in this buffer.</p>
          )}
        </nav>
      )}
    </div>
  )
}
