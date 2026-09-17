import { useEffect, useState } from 'react'
import type { Ticket } from '../../lib/types'
import type { LocalNote } from '../../../../shared/types/knowledge'
import { navigateTo } from '../../lib/nav'
import { noteBacklinks, noteNavigation } from './backlinks'

export function NoteBacklinks({ ticket, repoRoot }: { ticket: Ticket; repoRoot: string }) {
  const [notes, setNotes] = useState<LocalNote[]>([])
  const [status, setStatus] = useState('Loading note mentions…')
  useEffect(() => {
    let alive = true
    setNotes([])
    setStatus('Loading note mentions…')
    window.gt.notes
      .scan(repoRoot)
      .then((all) => {
        if (!alive) return
        const hits = noteBacklinks(all, ticket)
        setNotes(hits)
        setStatus(hits.length ? '' : 'No saved notes mention this ticket.')
      })
      .catch(() => {
        if (alive) setStatus('Could not scan local notes. Reopen this ticket to retry.')
      })
    return () => {
      alive = false
    }
  }, [repoRoot, ticket])
  return (
    <section aria-label="Notes mentioning this ticket" className="mb-4 text-xs text-zinc-400">
      <h3 className="mb-1 font-semibold">Notes mentioning this ticket</h3>
      <p role="status">{status}</p>
      {notes.map((note, i) => (
        <button
          key={i}
          className="mr-3 underline"
          onClick={() => navigateTo('notes', noteNavigation(note))}
        >
          {note.title} ({note.scope})
        </button>
      ))}
    </section>
  )
}
