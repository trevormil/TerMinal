import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { RepoTrustStatus } from '../lib/types'

// The review surface for the per-repo trust gate (src/main/repo-trust.ts) plus
// its persisted refusal (src/main/ipc/repo-trust-denials.ts).
//
// One component, rendered in two places — the Inbox drawer (where the badge
// leads) and the Plugins drawer (where you go looking for it) — so there is
// exactly one way this decision is ever presented. It always lists the literal
// commands: approving a hash you cannot read is not consent, and the whole
// point of the gate is that repo-controlled shell is untrusted until someone
// has actually read it. There is deliberately no bulk "trust all repos".

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

  const pending = !!status && status.commands.length > 0 && !status.trusted && !denied
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
  if (!status || status.commands.length === 0) return null
  if (hideWhenSettled && !pending) return null

  const { trusted, commands, repoRoot } = status
  const repoName = repoRoot.split('/').filter(Boolean).pop() || repoRoot
  // Red only while a decision is outstanding; settled either way is quiet.
  const tone = pending
    ? 'border-[var(--gt-red)]/50 bg-[var(--gt-red)]/10'
    : 'border-[var(--gt-border)] bg-black/20'

  return (
    <div className={`mb-4 rounded-xl border p-3 ${tone}`}>
      <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-zinc-100">
        {trusted ? (
          <ShieldCheck size={14} strokeWidth={2} className="text-[var(--gt-green)]" />
        ) : denied ? (
          <ShieldX size={14} strokeWidth={2} className="text-zinc-500" />
        ) : (
          <ShieldAlert size={14} strokeWidth={2} className="text-[var(--gt-red)]" />
        )}
        {trusted
          ? 'Repo widgets trusted'
          : denied
            ? 'Repo widgets blocked'
            : `${repoName} wants to run commands`}
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-zinc-400">
        {trusted
          ? 'These repo-defined commands run on their poll interval. Revoke to turn them back off.'
          : denied
            ? 'You blocked these. They stay off and will not ask again — unless the repo changes them, which is a new decision.'
            : 'Defined in this repo’s .TerMinal/widgets.json / tabs.json, so they come from whoever wrote the repo. They stay off until you approve them — read each one first.'}
      </p>
      <ul className="mb-2.5 space-y-1">
        {commands.map((c) => (
          <li
            key={c}
            className="overflow-x-auto whitespace-pre rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-300"
          >
            {c}
          </li>
        ))}
      </ul>
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
              {`Approve ${commands.length} command${commands.length > 1 ? 's' : ''}`}
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
