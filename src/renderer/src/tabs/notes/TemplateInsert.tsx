import { useEffect, useState } from 'react'
import { NOTE_TEMPLATES, appendTemplate } from './templates'
import type { NoteTemplate } from '../../../../shared/note-templates'

export function TemplateInsert({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [custom, setCustom] = useState<NoteTemplate[]>([])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    window.gt.settings
      .get()
      .then((settings) => {
        if (alive) setCustom(settings.noteTemplates || [])
      })
      .catch(() => {
        if (alive) setError('Could not load custom templates. Try again.')
      })
    return () => {
      alive = false
    }
  }, [])
  const load = async () => {
    try {
      setCustom((await window.gt.settings.get()).noteTemplates || [])
      setError('')
    } catch {
      setError('Could not load custom templates. Try again.')
    }
  }
  const save = async (remove?: string) => {
    setBusy(true)
    setError('')
    try {
      const current = (await window.gt.settings.get()).noteTemplates || []
      const next = remove
        ? current.filter((t) => t.id !== remove)
        : [...current, { id: 'custom:' + crypto.randomUUID(), title: title.trim(), body }]
      const saved = (await window.gt.settings.patch({ noteTemplates: next })).noteTemplates || []
      if (JSON.stringify(saved) !== JSON.stringify(next)) throw new Error('Save failed')
      setCustom(saved)
      if (!remove) {
        setTitle('')
        setBody('')
      }
    } catch {
      setError('Could not save templates. Your draft is still here; try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="relative flex items-center gap-2">
      <select
        aria-label="Append note template"
        value=""
        disabled={disabled}
        onFocus={() => void load()}
        className="rounded border border-[var(--gt-border)] bg-[var(--gt-panel)] px-2 py-1 text-xs text-zinc-300"
        onChange={(event) => onChange(appendTemplate(value, event.target.value, custom))}
      >
        <option value="" disabled>
          Append template…
        </option>
        <optgroup label="Built-in">
          {NOTE_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </optgroup>
        <optgroup label="Custom · local">
          {custom.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        disabled={disabled}
        className="text-xs text-zinc-400"
        onClick={() => {
          setOpen(!open)
          void load()
        }}
      >
        Custom templates
      </button>
      {open && (
        <section
          aria-label="Custom note templates"
          className="absolute right-0 top-full z-30 mt-2 w-80 space-y-2 rounded border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 shadow-xl"
        >
          <p className="text-xs text-zinc-400">
            Local markdown snippets, available across repos. Append keeps your existing note.
          </p>
          {custom.map((t) => (
            <div key={t.id} className="flex justify-between gap-2 text-xs">
              <span className="truncate">{t.title}</span>
              <button disabled={busy} onClick={() => void save(t.id)}>
                Delete
              </button>
            </div>
          ))}
          <input
            aria-label="Template name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Template name"
            className="w-full rounded border bg-transparent p-2 text-xs"
          />
          <textarea
            aria-label="Template markdown"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Markdown to append"
            className="h-32 w-full rounded border bg-transparent p-2 font-mono text-xs"
          />
          <button
            disabled={busy || !title.trim() || !body.trim()}
            onClick={() => void save()}
            className="text-xs disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save template'}
          </button>
          <button className="ml-3 text-xs" onClick={() => setOpen(false)}>
            Close
          </button>
        </section>
      )}
      {error && (
        <span role="alert" className="text-xs text-amber-400">
          {error}
        </span>
      )}
    </div>
  )
}
