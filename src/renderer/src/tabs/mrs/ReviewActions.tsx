import { useState } from 'react'
import { Check, Loader2, MessageSquare, Send, XOctagon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { PrActionResult, PrReviewEvent } from '../../lib/types'

// The write half of the review surface.
//
// Every path here is reached by a click and nothing else: no effect posts, no
// timer posts, no caller can pass a "submit on mount" flag. That is the whole
// safety property — the app hosts agents that open these PRs, and an approval
// it can produce without a human pressing a button is not an approval.

/** Inline error slot. The forge's own words, not a paraphrase. */
function ActionError({ error }: { error: string }) {
  if (!error) return null
  return <div className="mt-1.5 whitespace-pre-wrap text-[11px] text-destructive">{error}</div>
}

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const runAction = async (key: string, call: () => Promise<PrActionResult>): Promise<boolean> => {
    setBusy(key)
    setError('')
    try {
      const r = await call()
      if (!r.ok) {
        setError(r.error)
        return false
      }
      onDone()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy('')
    }
  }
  return { busy, error, runAction }
}

/** Submit a review: approve, request changes, or comment. */
export function ReviewActions({
  repoRoot,
  iid,
  onDone,
}: {
  repoRoot: string
  iid: number
  /** Refresh conversation + approval state after a successful submit. */
  onDone: () => void
}) {
  const [body, setBody] = useState('')
  const { busy, error, runAction } = useAction(onDone)

  const submit = async (event: PrReviewEvent) => {
    const ok = await runAction(event, () =>
      window.gt.githubReview.submit(repoRoot, iid, event, body),
    )
    if (ok) setBody('')
  }

  return (
    <div className="border-t border-border px-3 py-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Leave a review… (markdown)"
        className="min-h-0 resize-y"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="default"
          disabled={!!busy}
          aria-busy={busy === 'approve' || undefined}
          onClick={() => submit('approve')}
        >
          {busy === 'approve' ? <Loader2 className="animate-spin" /> : <Check />}
          Approve
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={!!busy || !body.trim()}
          aria-busy={busy === 'request-changes' || undefined}
          onClick={() => submit('request-changes')}
        >
          {busy === 'request-changes' ? <Loader2 className="animate-spin" /> : <XOctagon />}
          Request changes
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!!busy || !body.trim()}
          aria-busy={busy === 'comment' || undefined}
          onClick={() => submit('comment')}
        >
          {busy === 'comment' ? <Loader2 className="animate-spin" /> : <MessageSquare />}
          Comment
        </Button>
        <span className="ml-auto text-[10.5px] text-muted-foreground">
          Approving needs no body.
        </span>
      </div>
      <ActionError error={error} />
    </div>
  )
}

/** A top-level PR comment — the conversation's own reply box. */
export function CommentBox({
  repoRoot,
  iid,
  onDone,
}: {
  repoRoot: string
  iid: number
  onDone: () => void
}) {
  const [body, setBody] = useState('')
  const { busy, error, runAction } = useAction(onDone)
  return (
    <div className="px-3 py-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Comment on this pull request…"
        className="min-h-0 resize-y"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          disabled={!!busy || !body.trim()}
          aria-busy={!!busy || undefined}
          onClick={async () => {
            const ok = await runAction('comment', () =>
              window.gt.githubReview.comment(repoRoot, iid, body),
            )
            if (ok) setBody('')
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
          Comment
        </Button>
      </div>
      <ActionError error={error} />
    </div>
  )
}

/** Reply inside one inline review thread. */
export function ReplyBox({
  repoRoot,
  iid,
  replyToId,
  onDone,
}: {
  repoRoot: string
  iid: number
  replyToId: number
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const { busy, error, runAction } = useAction(onDone)

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        Reply
      </button>
    )

  return (
    <div className="mt-1.5">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Reply in this thread…"
        className="min-h-0 resize-y"
      />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          disabled={!!busy || !body.trim()}
          aria-busy={!!busy || undefined}
          onClick={async () => {
            const ok = await runAction('reply', () =>
              window.gt.githubReview.reply(repoRoot, iid, replyToId, body),
            )
            if (ok) {
              setBody('')
              setOpen(false)
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
          Reply
        </Button>
        <Button type="button" variant="ghost" disabled={!!busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <ActionError error={error} />
    </div>
  )
}
