import { useEffect, useState } from 'react'
import { ArrowUpCircle, CircleCheck, ClipboardCopy, Loader2, RotateCcw } from 'lucide-react'
import type { RepoStateStatus, TmPluginStatus, UpdateCheckResult } from '../../lib/types'
import { Button } from '@/components/ui/button'
import { Section, type SettingsSectionSpec } from './shared'

// Installed-build update status. Compares the baked build sha against
// origin/main (main process, update-check.ts) and offers the update action —
// which is just the existing Rebuild flow: bin/release pulls a clean main
// checkout before building, so "Update now" == release:start.
function UpdatesPanel() {
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const check = async () => {
    setChecking(true)
    try {
      setResult(await window.gt.update.check())
    } finally {
      setChecking(false)
    }
  }
  useEffect(() => {
    void check()
  }, [])

  const startUpdate = async () => {
    setError(null)
    setUpdating(true)
    const r = await window.gt.release.start()
    if ('error' in r) {
      setError(r.error)
      setUpdating(false)
    }
    // On success the release script quits + relaunches the app mid-flow —
    // leave the spinner on; the Rebuild section below tails the log.
  }

  const manualCmd = `cd ${result?.repoPath || '<TerMinal repo>'} && git checkout main && git pull && bun run release`
  const copyCmd = async () => {
    await navigator.clipboard.writeText(manualCmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const status = result?.status
  const statusText =
    checking && !result
      ? 'Checking…'
      : status === 'behind'
        ? `${result!.behindBy} commit${result!.behindBy === 1 ? '' : 's'} behind origin/main`
        : status === 'up-to-date'
          ? 'Up to date with origin/main'
          : status === 'diverged'
            ? 'Built from unmerged code (not on main) — re-release from main once it lands'
            : `Couldn't check${result?.error ? ` — ${result.error}` : ''}`
  const statusColor =
    status === 'behind'
      ? 'text-amber-400'
      : status === 'up-to-date'
        ? 'text-[var(--gt-green)]'
        : 'text-zinc-500'
  // bin/release only fast-forwards a CLEAN checkout that is ON main — warn when
  // "Update now" would silently rebuild a branch/dirty tree instead.
  const checkoutWarning =
    result?.source === 'git' &&
    (result.checkoutDirty ||
      (result.checkoutBranch &&
        result.checkoutBranch !== 'main' &&
        result.checkoutBranch !== 'master'))
      ? `The source checkout is ${result.checkoutBranch && result.checkoutBranch !== 'main' && result.checkoutBranch !== 'master' ? `on ${result.checkoutBranch}` : ''}${result.checkoutDirty ? `${result.checkoutBranch && result.checkoutBranch !== 'main' && result.checkoutBranch !== 'master' ? ' with' : ''} local changes` : ''} — Update now would rebuild it as-is instead of pulling main.`
      : null

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[11.5px]">
          <span className="text-zinc-600">Installed build</span>
          <span className="font-mono text-zinc-300">
            {__BUILD_SHA__} on {__BUILD_BRANCH__} · {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}
          </span>
          <span className="text-zinc-600">Latest main</span>
          <span className="font-mono text-zinc-300">
            {result?.latestSha || (checking ? '…' : 'unknown')}
            {result?.source === 'github' && (
              <span className="ml-1.5 text-[10px] text-zinc-600">(via GitHub API)</span>
            )}
          </span>
          <span className="text-zinc-600">Status</span>
          <span className={statusColor}>{statusText}</span>
        </div>
        {result?.buildDirty && (
          <div className="mt-1.5 text-[10.5px] text-amber-400/80">
            This build came from an uncommitted working tree (-dirty) — the comparison uses its base
            commit.
          </div>
        )}
        {checkoutWarning && (
          <div className="mt-1.5 text-[10.5px] text-amber-400/80">{checkoutWarning}</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={check}
          disabled={checking}
          aria-busy={checking || undefined}
        >
          {checking ? <Loader2 className="animate-spin" /> : <RotateCcw strokeWidth={2} />}
          Check now
        </Button>
        <Button
          type="button"
          variant="default"
          className="flex-1 justify-start"
          onClick={startUpdate}
          disabled={updating || status !== 'behind'}
          aria-busy={updating || undefined}
        >
          {updating ? <Loader2 className="animate-spin" /> : <ArrowUpCircle strokeWidth={2} />}
          {updating ? 'Updating… (app will quit + relaunch automatically)' : 'Update now'}
          <span className="ml-auto text-[10.5px] font-normal text-zinc-600">
            pull main + bun run release
          </span>
        </Button>
      </div>
      {error && <div className="text-[11px] text-amber-400">{error}</div>}
      <Button
        type="button"
        variant="secondary"
        className="w-full justify-start"
        onClick={copyCmd}
      >
        {copied ? (
          <CircleCheck strokeWidth={2} className="shrink-0 text-[var(--gt-green)]" />
        ) : (
          <ClipboardCopy strokeWidth={2} className="shrink-0 text-zinc-600" />
        )}
        <span className="truncate font-mono font-normal">{manualCmd}</span>
        <span className="ml-auto shrink-0 text-[10px] font-normal text-zinc-600">
          {copied ? 'Copied' : 'Copy manual update'}
        </span>
      </Button>
    </div>
  )
}

// The global tm plugin (skills/hooks for every repo) is installed by the app at
// ~/.config/TerMinal/plugin and linked as ~/.claude/skills/tm. Startup keeps it
// current; Sync repairs the copy + symlink on demand.
function TmPluginPanel() {
  const [status, setStatus] = useState<TmPluginStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => setStatus(await window.gt.plugin.status())
  useEffect(() => {
    void refresh()
  }, [])

  const sync = async () => {
    setError(null)
    setSyncing(true)
    try {
      const r = await window.gt.plugin.sync()
      if (!r.ok) setError(r.error)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  const stateText = !status
    ? 'Checking…'
    : !status.installed
      ? 'Not installed'
      : status.shadowedBy
        ? `v${status.version ?? '?'} installed but NOT loaded — ${status.shadowedBy} takes precedence. Uninstall it (claude plugin uninstall ${status.shadowedBy}) to use the app-managed copy.`
        : !status.linked
          ? `v${status.version ?? '?'} installed — ~/.claude/skills/tm link missing`
          : `v${status.version ?? '?'} · /tm:* skills in every repo${status.codexSkills ? ` · ${status.codexSkills} codex tm-* skills` : ''}`
  const stateColor =
    status && status.installed && status.linked && !status.shadowedBy
      ? 'text-[var(--gt-green)]'
      : 'text-amber-400'

  return (
    <div className="mt-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] text-zinc-300">tm plugin (global skills)</div>
          <div className={`text-[10.5px] ${status ? stateColor : 'text-zinc-500'}`}>
            {stateText}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={sync}
          disabled={syncing}
          aria-busy={syncing || undefined}
        >
          {syncing ? <Loader2 className="animate-spin" /> : <RotateCcw strokeWidth={2} />}
          Sync
        </Button>
      </div>
      {error && <div className="mt-1.5 text-[10.5px] text-amber-400">{error}</div>}
    </div>
  )
}

// Per-project sidecar: workflow state (tickets, reviews, sessions) lives
// outside the repo so a shared checkout never receives it. Surfaces where that
// is for the active repo and offers the one-time move for repos that still
// carry theirs in-tree.
function RepoStatePanel() {
  const [status, setStatus] = useState<RepoStateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = async () => setStatus(await window.gt.repoState.status())
  useEffect(() => {
    void refresh()
    // The in-session MigrateBanner runs the same one-time move — refresh the
    // counts here when it does, so the two surfaces never disagree.
    const onMigrated = () => void refresh()
    window.addEventListener('gt.repo-state.migrated', onMigrated)
    return () => window.removeEventListener('gt.repo-state.migrated', onMigrated)
  }, [])

  const migrate = async () => {
    setNote(null)
    setBusy(true)
    try {
      const r = await window.gt.repoState.migrate()
      if (r.error) setNote(r.error)
      else if (r.moved === 0 && !r.sweptCopies)
        setNote('Nothing to move — this repo is already clean.')
      else
        setNote(
          `Moved ${r.moved} file(s) into the sidecar.` +
            (r.sweptCopies
              ? ` Banked ${r.sweptCopies} plugin-served skill/hook copies in .claude/pre-tm-backup.`
              : '') +
            (r.skipped.length
              ? ` ${r.skipped.length} left in the repo (already present in the sidecar) — reconcile by hand.`
              : ' Commit the deletions in the repo to finish.'),
        )
      await refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] text-zinc-300">Project state (sidecar)</div>
          <div className="truncate font-mono text-[10.5px] text-zinc-500">
            {status?.path || 'no repo selected'}
          </div>
          <div
            className={`text-[10.5px] ${status?.pending || status?.legacyCopies ? 'text-amber-400' : 'text-zinc-500'}`}
          >
            {!status
              ? 'Checking…'
              : status.pending || status.legacyCopies
                ? [
                    status.pending ? `${status.pending} state file(s) still in the repo` : '',
                    status.legacyCopies
                      ? `${status.legacyCopies} plugin-served skill/hook copies`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' + ') + ' — move them out so collaborators don’t get them'
                : status.isRepo
                  ? `versioned · ${status.commits} commit${status.commits === 1 ? '' : 's'}`
                  : 'nothing in the repo to move'}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={migrate}
          disabled={busy || !(status?.pending || status?.legacyCopies)}
          aria-busy={busy || undefined}
        >
          {busy ? <Loader2 className="animate-spin" /> : <RotateCcw strokeWidth={2} />}
          Move out of repo
        </Button>
      </div>
      {note && <div className="mt-1.5 text-[10.5px] text-zinc-400">{note}</div>}
    </div>
  )
}

function Component() {
  return (
    <Section
      id="updates"
      icon={ArrowUpCircle}
      title="Updates"
      desc="Is the installed app behind main? Compares the baked build commit against origin/main (local checkout first, GitHub API fallback)."
    >
      <UpdatesPanel />
      <TmPluginPanel />
      <RepoStatePanel />
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'updates',
  title: 'Updates',
  icon: ArrowUpCircle,
  order: 22,
  Component,
}
export default section
