import { useState } from 'react'
import { GitMerge, Check, X, Loader2, ShieldAlert } from 'lucide-react'
import { blockedLegs, describeBlockers, type MergeGate } from '../lib/mergeGate'

// Human-initiated MR/PR merge (the user clicks; the app shells out to gh/glab).
// A confirm step gates the irreversible-ish action; errors from the forge CLI
// (pipeline must pass, conflicts, approvals required) surface inline.
//
// When `gate` says the merge-ready bar (CLAUDE.md §8) is not met, the button
// becomes a warning that must be acknowledged first. It is a plain yes/no —
// the human is told what could not be verified and answers. The override is
// still recorded, but silently: the audit trail is the app's job, not a form
// the human fills in at the moment they are trying to merge.
//
// This only ADDS friction. It never merges anything on its own, never relaxes
// the human merge gate, and never auto-approves.
export function MrMergeButton({
  iid,
  sym = '!',
  gate,
  repoRoot = '',
  onMerged,
}: {
  iid: number
  sym?: string
  /** Omitted = no gate evaluated (list rows without review data); merges as before. */
  gate?: MergeGate
  repoRoot?: string
  onMerged?: () => void
}) {
  const [stage, setStage] = useState<'idle' | 'blocked' | 'confirm' | 'merging'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const blocked = !!gate && !gate.allowed

  const doMerge = async (e: React.MouseEvent) => {
    stop(e)
    setStage('merging')
    setErr(null)
    try {
      const r = await window.gt.mergeMr(iid)
      if (r.ok) onMerged?.()
      else setErr(r.error || 'Merge failed')
    } catch (e2) {
      setErr((e2 as Error).message || 'Merge failed')
    } finally {
      // In `finally` so a rejection cannot pin the button to "merging…".
      setStage('idle')
    }
  }

  /**
   * Record the override and merge.
   *
   * The record is fire-and-forget on purpose: it is an audit side effect, and a
   * failure to write it (handler unregistered, disk full) must not stand
   * between a human and merging their own PR. It is still awaited *before* the
   * merge so the ordering on disk stays honest.
   */
  const overrideAndMerge = async (e: React.MouseEvent) => {
    stop(e)
    if (!gate) return
    try {
      await window.gt.mergeGate.override({
        prIid: iid,
        repoRoot,
        legs: blockedLegs(gate),
        blockers: describeBlockers(gate),
      })
    } catch {
      /* audit only — never block the merge on it */
    }
    await doMerge(e)
  }

  if (err)
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400" title={err}>
        <X size={12} strokeWidth={2.5} />
        Merge failed
        <button
          onClick={(e) => {
            stop(e)
            setErr(null)
          }}
          className="ml-1 underline hover:text-amber-300"
        >
          Retry
        </button>
      </span>
    )

  if (stage === 'merging')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
        <Loader2 size={12} strokeWidth={2.5} className="animate-spin" />
        merging…
      </span>
    )

  // The override confirm. One question, the reasons it is being asked, yes/no.
  if (stage === 'blocked' && gate)
    return (
      <span className="inline-flex max-w-[520px] flex-col gap-1.5 rounded-md border border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 p-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--gt-red)]">
          <ShieldAlert size={12} strokeWidth={2.5} />
          Warning: this PR isn&apos;t fully checked.
        </span>
        <ul className="space-y-0.5 text-[11px] text-zinc-300">
          {gate.blockers.map((b) => (
            <li key={b.kind} title={b.detail}>
              · {b.label}
            </li>
          ))}
        </ul>
        <span className="text-[11px] text-zinc-400">Are you sure you want to continue?</span>
        <span className="flex items-center gap-1.5">
          <button
            onClick={overrideAndMerge}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-red)]/50 bg-[var(--gt-red)]/15 px-2 py-1 text-[11px] font-semibold text-[var(--gt-red)] hover:bg-[var(--gt-red)]/25"
          >
            Yes, merge {sym}
            {iid}
          </button>
          <button
            onClick={(e) => {
              stop(e)
              setStage('idle')
            }}
            className="rounded-md border border-[var(--gt-border)] px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            No
          </button>
        </span>
      </span>
    )

  if (stage === 'confirm')
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-[11px] text-zinc-400">
          merge {sym}
          {iid}?
        </span>
        <button
          onClick={doMerge}
          title="Confirm merge"
          className="inline-flex items-center rounded-md border border-[var(--gt-green)]/40 bg-[var(--gt-green)]/15 p-1 text-[var(--gt-green)] hover:bg-[var(--gt-green)]/25"
        >
          <Check size={12} strokeWidth={2.5} />
        </button>
        <button
          onClick={(e) => {
            stop(e)
            setStage('idle')
          }}
          title="Cancel"
          className="inline-flex items-center rounded-md border border-[var(--gt-border)] p-1 text-zinc-400 hover:text-zinc-200"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </span>
    )

  if (blocked)
    return (
      <button
        onClick={(e) => {
          stop(e)
          setStage('blocked')
        }}
        title={gate.blockers.map((b) => `${b.label}\n${b.detail}`).join('\n\n')}
        className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-red)]/40 bg-[var(--gt-red)]/10 px-2 py-1 text-[11px] text-[var(--gt-red)] hover:bg-[var(--gt-red)]/20"
      >
        <ShieldAlert size={12} strokeWidth={2} />
        Merge blocked
        <span className="text-zinc-500">· {gate.blockers.length}</span>
      </button>
    )

  return (
    <button
      onClick={(e) => {
        stop(e)
        setStage('confirm')
      }}
      title={
        gate?.warnings.length
          ? `Merge ${sym}${iid}\n${gate.warnings.join('\n')}`
          : `Merge ${sym}${iid}`
      }
      className="inline-flex items-center gap-1 rounded-md border border-[var(--gt-green)]/40 bg-[var(--gt-green)]/10 px-2 py-1 text-[11px] text-[var(--gt-green)] hover:bg-[var(--gt-green)]/20"
    >
      <GitMerge size={12} strokeWidth={2} />
      Merge
      {gate?.warnings.length ? <span className="text-amber-400">·!</span> : null}
    </button>
  )
}
