import { useEffect, useState } from 'react'
import { ArrowUpCircle, X } from 'lucide-react'
import type { UpdateCheckResult } from '../lib/types'

// Non-blocking "installed app is behind main" notice, shown bottom-right on
// launch when the startup check (main process) confirms the installed build's
// commit is behind origin/main. Dismissal persists per upstream sha, so the
// banner returns only when main moves again — not on every app open.
const DISMISS_KEY = 'gt-update-dismissed-sha'

export function UpdateBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [result, setResult] = useState<UpdateCheckResult | null>(null)

  useEffect(() => {
    const apply = (r: UpdateCheckResult) => {
      if (r.status !== 'behind') return
      if (localStorage.getItem(DISMISS_KEY) === r.latestSha) return
      setResult(r)
    }
    // Subscribe first (covers the main-process push ~2.5s after load), then
    // check once ourselves in case the push already fired before mount.
    const off = window.gt.update.onStatus(apply)
    window.gt.update
      .check()
      .then(apply)
      .catch(() => {})
    return off
  }, [])

  if (!result) return null
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, result.latestSha)
    } catch {
      /* session-level dismiss still applies */
    }
    setResult(null)
  }
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[340px] rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3 shadow-2xl">
      <div className="flex items-start gap-2.5">
        <ArrowUpCircle
          size={16}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-[var(--gt-accent-light)]"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-zinc-100">Update available</div>
          <div className="mt-0.5 text-[11px] leading-snug text-zinc-400">
            The installed app is {result.behindBy} commit{result.behindBy === 1 ? '' : 's'} behind
            main{' '}
            <span className="font-mono text-zinc-500">
              ({result.buildSha} → {result.latestSha})
            </span>
            .
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => {
                setResult(null)
                onOpenSettings()
              }}
              className="rounded-md border border-[var(--gt-accent)]/40 bg-[var(--gt-accent)]/10 px-2.5 py-1 text-[11px] text-zinc-100 hover:bg-[var(--gt-accent)]/20"
            >
              Update in Settings
            </button>
            <button
              onClick={dismiss}
              className="px-1 py-1 text-[10.5px] text-zinc-600 hover:text-zinc-400"
            >
              Skip this version
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 rounded-md p-1 text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
