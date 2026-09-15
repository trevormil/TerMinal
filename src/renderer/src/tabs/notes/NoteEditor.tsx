import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { CodeEditor } from '../../components/CodeEditor'
import type { NoteTemplate } from '../../../../shared/note-templates'
import { appendSlashTemplate, matchTemplates, slashCommand, type SlashCommand } from './templates'

export function NoteEditor({
  value,
  onChange,
  extensions = [],
  editable = true,
  textarea = false,
}: {
  value: string
  onChange: (value: string) => void
  extensions?: Extension[]
  editable?: boolean
  wrap?: boolean
  textarea?: boolean
}) {
  const [command, setCommand] = useState<SlashCommand | null>(null)
  const [custom, setCustom] = useState<NoteTemplate[]>([])
  const [error, setError] = useState('')
  const textArea = useRef<HTMLTextAreaElement>(null)
  const view = useRef<EditorView | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const listener = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.docChanged && !update.selectionSet) return
        const selection = update.state.selection.main
        setCommand(
          update.view.hasFocus && update.docChanged && selection.empty
            ? slashCommand(update.state.doc.toString(), selection.head)
            : null,
        )
      }),
    [],
  )
  const open = command !== null
  useEffect(() => {
    if (!open) return
    let alive = true
    window.gt.settings
      .get()
      .then((settings) => {
        if (alive) {
          setCustom(settings.noteTemplates || [])
          setError('')
        }
      })
      .catch(() => {
        if (alive) setError('Could not load custom templates. Built-ins are available.')
      })
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setCommand(null)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => {
      alive = false
      document.removeEventListener('pointerdown', dismiss)
    }
  }, [open])
  const matches = command ? matchTemplates(command.query, custom) : []
  const insert = (id: string) => {
    if (!command) return
    if (textarea) {
      onChange(appendSlashTemplate(value, command, id, custom))
      setCommand(null)
      textArea.current?.focus()
      return
    }
    if (!view.current) return
    const editor = view.current
    const next = appendSlashTemplate(editor.state.doc.toString(), command, id, custom)
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: next },
      selection: { anchor: next.length },
    })
    setCommand(null)
    editor.focus()
  }
  return (
    <div
      ref={root}
      className="relative h-full min-h-0"
      onKeyDownCapture={(event) => {
        if (!command) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setCommand(null)
        }
        if (
          event.key === 'Enter' &&
          matches.length &&
          (event.target === view.current?.contentDOM || event.target === textArea.current)
        ) {
          event.preventDefault()
          event.stopPropagation()
          insert(matches[0].id)
        }
      }}
    >
      {textarea ? (
        <textarea
          ref={textArea}
          aria-label="Path note content"
          value={value}
          disabled={!editable}
          onChange={(event) => {
            onChange(event.target.value)
            setCommand(slashCommand(event.target.value, event.target.selectionStart))
          }}
          onClick={() => setCommand(null)}
          className="h-full min-h-32 w-full resize-none rounded border border-[var(--gt-border)] bg-transparent p-3 font-mono text-sm"
        />
      ) : (
        <CodeEditor
          value={value}
          onChange={onChange}
          editable={editable}
          extensions={[...extensions, listener]}
          wrap
          onView={(editor) => {
            view.current = editor
          }}
        />
      )}
      {command && editable && (
        <section
          aria-label="Slash note templates"
          className="absolute left-4 top-4 z-30 max-h-64 w-72 overflow-auto rounded border border-[var(--gt-border)] bg-[var(--gt-panel)] p-2 shadow-xl"
        >
          <p className="p-1 text-xs text-muted-foreground">Append template · /{command.query}</p>
          {matches.map((template) => (
            <button
              key={template.id}
              type="button"
              className="block w-full rounded p-2 text-left text-sm hover:bg-white/10"
              onClick={() => insert(template.id)}
            >
              {template.title}
              {template.id.startsWith('custom:') ? ' · local' : ''}
            </button>
          ))}
          {!matches.length && <p className="p-2 text-xs">No matching templates.</p>}
          {error && (
            <p role="alert" className="p-2 text-xs text-amber-400">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
