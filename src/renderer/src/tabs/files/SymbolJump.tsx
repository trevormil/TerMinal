import { useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { localDefinitions, symbolAt } from './symbols'

export function SymbolJump({ getView }: { getView: () => EditorView | undefined }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ReturnType<typeof localDefinitions> | null>(null)
  const search = (selection = false) => {
    const view = getView()
    if (!view) return
    const source = view.state.doc.toString()
    const name = selection ? symbolAt(source, view.state.selection.main.head) : query
    if (selection) setQuery(name)
    setHits(selection && !name ? [] : localDefinitions(source, name))
  }
  return (
    <div className="border-b border-[var(--gt-border)] p-2 text-xs">
      <form
        className="flex items-center gap-2"
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
      </form>
      {hits && (
        <div role="status" className="max-h-28 overflow-auto pt-2 text-zinc-400">
          {hits.length
            ? hits.map((hit) => (
                <button
                  key={hit.offset}
                  className="mr-3 underline"
                  onClick={() => {
                    const view = getView()
                    if (!view) return
                    const current = localDefinitions(view.state.doc.toString(), hit.name).find(
                      (item) => item.line === hit.line,
                    )
                    if (!current) {
                      search()
                      return
                    }
                    view.dispatch({
                      selection: {
                        anchor: current.offset,
                        head: current.offset + current.name.length,
                      },
                      scrollIntoView: true,
                    })
                    view.focus()
                  }}
                >
                  {hit.name}:{hit.line}
                </button>
              ))
            : 'No local definition found. Search uses common declarations in this file.'}
        </div>
      )}
    </div>
  )
}
