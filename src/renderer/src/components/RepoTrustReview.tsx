import { ChevronDown, ChevronRight, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { commandsCollapsible, trustPanelState } from '../lib/repoTrust'
import type { RepoTrustStatus } from '../lib/types'

// The review surface for the per-repo trust gate (src/main/repo-trust.ts) plus
// its persisted refusal (src/main/ipc/repo-trust-denials.ts).
//
// One component, rendered in two places — the Plugins drawer (where the header's
// trust dot leads, and where widgets are managed) and the Inbox tab — so there is
// exactly one way this decision is ever presented. While a decision is
// outstanding it always lists the literal commands: approving a hash you cannot
// read is not consent, and the whole point of the gate is that repo-controlled
// shell is untrusted until someone has actually read it. There is deliberately
// no bulk "trust all repos", and no approve-from-the-badge.
//
// Once trusted, the command list collapses behind a disclosure — by definition
// the user has already read that exact set, and re-reading it on every visit is
// noise. That asymmetry is enforced by `commandsCollapsible`, not by this
// component's own judgement.

export type RepoTrustPrompt = {
  status: RepoTrustStatus | null
  denied: boolean
  /** Needs a human decision: has commands, not approved, not already refused. */
  pending: boolean
  refresh: () => void
}

export function useRepoTrustPrompt(pollMs = 0): RepoTrustPrompt {
  const [status, setStatus] = useState<RepoTrustStatus | null>(null)
  const [denied, setDenied] = useState(false)

  const refresh = useCallback(() => {
    window.gt.repoTrust
      .status()
      .then(async (s) => {
        setStatus(s)
        // Fail closed on the PROMPT, not on trust: if the denial lookup breaks
        // we show the prompt again rather than silently suppressing it.
        setDenied(
          s.trusted
            ? false
            : await window.gt.repoTrust.denied(s.repoRoot, s.hash).catch(() => false),
        )
      })
      .catch(() => {
        setStatus(null)
        setDenied(false)
      })
  }, [])

  useEffect(() => {
    refresh()
    if (!pollMs) return
    const t = setInterval(refresh, pollMs)
    return () => clearInterval(t)
  }, [refresh, pollMs])

  const pending = trustPanelState(status, denied) === 'pending'
  return { status, denied, pending, refresh }
}

/**
 * @param prompt shared state, so the badge and the card never disagree
 * @param hideWhenSettled drop the card entirely once there is nothing to decide
 *        (the Inbox wants this; the Plugins drawer keeps showing the state)
 */
export function RepoTrustReview({
  prompt,
  hideWhenSettled = false,
}: {
  prompt: RepoTrustPrompt
  hideWhenSettled?: boolean
}) {
  const { status, denied, pending, refresh } = prompt
  // Collapsed only ever applies to the trusted state (commandsCollapsible), so
  // starting collapsed can never hide commands anyone still has to read.
  const [expanded, setExpanded] = useState(false)
  const state = trustPanelState(status, denied)
  if (!status || state === 'none') return null
  if (hideWhenSettled && !pending) return null

  const { trusted, commands, repoRoot } = status
  const repoName = repoRoot.split('/').filter(Boolean).pop() || repoRoot
  // Red only while a decision is outstanding; settled either way is quiet.
  const tone = pending
    ? 'border-[var(--gt-red)]/50 bg-[var(--gt-red)]/10'
    : 'border-[var(--gt-border)] bg-black/20'
  const collapsible = commandsCollapsible(state)
  const showCommands = !collapsible || expanded
  const count = `${commands.length} command${commands.length > 1 ? 's' : ''}`

  return (
    <div className={`mb-4 rounded-xl border p-3 ${tone}`}>
      <HeaderRow
        collapsible={collapsible}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      >
        {trusted ? (
          <ShieldCheck size={14} strokeWidth={2} className="shrink-0 text-[var(--gt-green)]" />
        ) : denied ? (
          <ShieldX size={14} strokeWidth={2} className="shrink-0 text-zinc-500" />
        ) : (
          <ShieldAlert size={14} strokeWidth={2} className="shrink-0 text-[var(--gt-red)]" />
        )}
        {trusted
          ? 'Repo widgets trusted'
          : denied
            ? 'Repo widgets blocked'
            : `${repoName} wants to run commands`}
        {collapsible && <span className="font-normal text-zinc-500">· {count}</span>}
      </HeaderRow>
      {showCommands && (
        <>
          <p className="mb-2 text-[11px] leading-relaxed text-zinc-400">
            {trusted
              ? 'These repo-defined commands run on their poll interval. Revoke to turn them back off.'
              : denied
                ? 'You blocked these. They stay off and will not ask again — unless the repo changes them, which is a new decision.'
                : 'Defined in this repo’s .TerMinal/widgets.json / tabs.json, so they come from whoever wrote the repo. They stay off until you approve them — read each one first.'}
          </p>
          <ul className="mb-2.5 space-y-1">
            {commands.map((c) => (
              // Wrapped, not horizontally scrolled: a command you have to drag
              // to finish reading is a command you will approve unread.
              <li
                key={c}
                className="whitespace-pre-wrap break-all rounded bg-black/40 px-2 py-1 font-mono text-[11px] leading-relaxed text-zinc-300"
              >
                {c}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {trusted ? (
          <TrustButton onClick={() => window.gt.repoTrust.revoke().then(refresh)}>
            Revoke trust
          </TrustButton>
        ) : denied ? (
          <TrustButton onClick={() => window.gt.repoTrust.undeny(repoRoot).then(refresh)}>
            Reconsider
          </TrustButton>
        ) : (
          <>
            <TrustButton onClick={() => window.gt.repoTrust.approve().then(refresh)}>
              {`Approve ${count}`}
            </TrustButton>
            <TrustButton
              onClick={() => window.gt.repoTrust.deny(repoRoot, status.hash).then(refresh)}
            >
              Block
            </TrustButton>
          </>
        )}
      </div>
    </div>
  )
}

/** The title line, made a disclosure button only when collapsing is allowed. */
function HeaderRow({
  collapsible,
  expanded,
  onToggle,
  children,
}: {
  collapsible: boolean
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const cls = 'mb-1.5 flex w-full items-center gap-2 text-[12px] font-semibold text-zinc-100'
  if (!collapsible) return <div className={cls}>{children}</div>
  return (
    <button onClick={onToggle} aria-expanded={expanded} className={`${cls} text-left`}>
      {expanded ? (
        <ChevronDown size={13} strokeWidth={2.5} className="shrink-0 text-zinc-500" />
      ) : (
        <ChevronRight size={13} strokeWidth={2.5} className="shrink-0 text-zinc-500" />
      )}
      {children}
    </button>
  )
}

function TrustButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="h-7 rounded-md border border-[var(--gt-border)] bg-black/30 px-3 text-[11.5px] text-zinc-200 hover:border-[var(--gt-accent)]/60"
    >
      {children}
    </button>
  )
}
