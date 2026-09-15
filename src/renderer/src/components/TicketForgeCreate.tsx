import { useState } from 'react'
import type { Ticket } from '../lib/types'
import type { ForgeCreateContext } from '../../../shared/forge-create'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

export function TicketForgeCreate({
  ticket,
  onChanged,
}: {
  ticket: Ticket
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [context, setContext] = useState<ForgeCreateContext | null>(null)
  const [head, setHead] = useState('')
  const [base, setBase] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const suggested =
    (ticket.externalKey || String(ticket.id)) +
    '-' +
    ticket.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  const begin = async () => {
    setOpen(true)
    setContext(null)
    setError('')
    setUrl('')
    setTitle((ticket.externalKey || '#' + ticket.id) + ': ' + ticket.title)
    setBody(
      (ticket.url ? 'Ticket: ' + ticket.url : 'Ticket: ' + ticket.slug) + '\n\n' + ticket.body,
    )
    try {
      const next = await window.gt.forgeCreateContext()
      setContext(next)
      setHead(next.head || suggested)
      setBase(next.base)
    } catch {
      setError('Could not load forge details. Close and try again.')
    }
  }
  const create = async () => {
    if (!context || busy || url) return
    setBusy(true)
    setError('')
    try {
      const result = await window.gt.createForgeRequest(context.repoRoot, ticket.slug, {
        head: head.trim(),
        base: base.trim(),
        title: title.trim(),
        body,
      })
      if (!result.url) {
        setError(result.error || 'Creation failed.')
        return
      }
      setUrl(result.url)
      setError(result.warning || '')
      onChanged()
    } catch {
      setError('The request did not complete. Check the forge before retrying.')
    } finally {
      setBusy(false)
    }
  }
  const field = 'w-full rounded border border-[var(--gt-border)] bg-transparent p-2 text-sm'
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => void begin()}>
        Create PR/MR
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {context?.label || 'PR/MR'} from ticket</DialogTitle>
          </DialogHeader>
          {context?.error ? (
            <p role="status" className="text-sm text-zinc-400">
              {context.error}
            </p>
          ) : !context ? (
            <p>Loading forge…</p>
          ) : url ? (
            <Button onClick={() => window.gt.openExternal(url)}>
              Open created {context.label}
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                Creates a real {context.label} on your forge. Push your source branch first. Branch
                names are editable.
              </p>
              <label className="block text-xs">
                Source branch
                <input
                  className={field}
                  aria-label="Source branch"
                  value={head}
                  disabled={busy}
                  onChange={(e) => setHead(e.target.value)}
                />
              </label>
              <div className="flex gap-3 text-xs">
                <button disabled={busy || !context.head} onClick={() => setHead(context.head)}>
                  Use current branch
                </button>
                <button disabled={busy} onClick={() => setHead(suggested)}>
                  Use ticket branch name
                </button>
              </div>
              <label className="block text-xs">
                Target branch
                <input
                  className={field}
                  aria-label="Target branch"
                  value={base}
                  disabled={busy}
                  onChange={(e) => setBase(e.target.value)}
                />
              </label>
              <label className="block text-xs">
                Title
                <input
                  className={field}
                  aria-label="PR/MR title"
                  value={title}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="block text-xs">
                Description
                <textarea
                  className={field + ' h-40'}
                  aria-label="PR/MR description"
                  value={body}
                  disabled={busy}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <Button
                disabled={
                  busy ||
                  !head.trim() ||
                  !base.trim() ||
                  !title.trim() ||
                  head.trim() === base.trim()
                }
                onClick={() => void create()}
              >
                {busy ? 'Creating…' : 'Create ' + context.label}
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-amber-400">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
