import { useContext, useEffect, useState, type ReactNode } from 'react'
import { FolderOpen, FolderTree, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import type { ProjectsDirValidation } from '../../lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ActiveSectionContext,
  EditDetails,
  Section,
  formatBytes,
  tilde,
  type SettingsCtx,
  type SettingsSectionSpec,
} from './shared'

const valueText = (value: string, fallback: string) => (
  <span
    className={`min-w-0 truncate font-mono text-[11.5px] ${value ? 'text-zinc-300' : 'text-zinc-500'}`}
  >
    {value ? tilde(value) : fallback}
  </span>
)

function PathSetting({
  label,
  value,
  fallback,
  detail,
  onBrowse,
  onClear,
  children,
}: {
  label: string
  value: string
  fallback: string
  detail?: string
  onBrowse?: () => void
  onClear?: () => void
  children?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            {label}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {valueText(value, fallback)}
            {!value && (
              <span className="rounded border border-[var(--gt-border)] px-1 py-px text-[9.5px] text-zinc-600">
                Default
              </span>
            )}
          </div>
          {detail && (
            <div className="mt-0.5 text-[10.5px] leading-snug text-zinc-600">{detail}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onBrowse && (
            <Button type="button" variant="secondary" size="sm" onClick={onBrowse}>
              <FolderOpen strokeWidth={2} />
              Browse
            </Button>
          )}
          {value && onClear && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="text-zinc-500 hover:text-zinc-300"
            >
              Use default
            </Button>
          )}
        </div>
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { selectedIsRemote, selectedDaemon, selectedHost, saveDaemon, profile } = ctx
  const active = useContext(ActiveSectionContext)

  const [projectsDirValidation, setProjectsDirValidation] = useState<ProjectsDirValidation | null>(
    null,
  )
  useEffect(() => {
    let alive = true
    void window.gt.settings
      .validateProjectsDir({ dir: selectedDaemon.projectsDir, hostId: selectedHost?.id })
      .then((v) => {
        if (alive) setProjectsDirValidation(v)
      })
    return () => {
      alive = false
    }
  }, [selectedDaemon.projectsDir, selectedHost?.id])

  const [storage, setStorage] = useState<Awaited<
    ReturnType<typeof window.gt.settings.storageReport>
  > | null>(null)
  const [storageBusy, setStorageBusy] = useState<'scan' | 'reclaim' | 'scratch' | null>(null)
  const refreshStorage = async () => {
    setStorageBusy('scan')
    try {
      setStorage(await window.gt.settings.storageReport())
    } finally {
      setStorageBusy(null)
    }
  }
  const reclaimStorage = async () => {
    setStorageBusy('reclaim')
    try {
      setStorage(await window.gt.settings.reclaimStorage())
    } finally {
      setStorageBusy(null)
    }
  }
  const clearScratch = async () => {
    setStorageBusy('scratch')
    try {
      await window.gt.settings.clearScratch()
      setStorage(await window.gt.settings.storageReport())
    } finally {
      setStorageBusy(null)
    }
  }
  // The storage estimate walks all of ~/.config/TerMinal (can be many GB /
  // hundreds of thousands of files) — scan only when the section showing it
  // opens, never on Settings open.
  useEffect(() => {
    if (active === 'paths' && !storage && storageBusy === null) void refreshStorage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const browseDaemon = async (key: 'projectsDir' | 'worktreesDir' | 'harnessDir') => {
    if (selectedIsRemote) return
    const d = await window.gt.pickDir()
    if (d) void saveDaemon({ [key]: d })
  }

  return (
    <Section
      id="paths"
      icon={FolderTree}
      title="Projects & worktrees"
      desc={
        selectedIsRemote
          ? 'Remote daemon paths. Enter paths as they exist on the SSH host.'
          : 'Where the entry screen looks for repos, and where agent worktrees are created.'
      }
    >
      <div className="space-y-2">
        <PathSetting
          label="Projects directory"
          value={selectedDaemon.projectsDir}
          fallback={selectedIsRemote ? 'Remote home folder' : 'Home folder'}
          detail={
            selectedIsRemote
              ? 'Default remote workspace directory for this SSH profile.'
              : 'Used by the entry screen for new workspaces and scaffold destinations.'
          }
          onBrowse={selectedIsRemote ? undefined : () => browseDaemon('projectsDir')}
          onClear={() => saveDaemon({ projectsDir: '' })}
        >
          {!selectedIsRemote &&
            projectsDirValidation?.ok &&
            typeof projectsDirValidation.repoCount === 'number' &&
            projectsDirValidation.repoCount > 0 && (
              <div className="mb-2 text-[10.5px] text-[var(--gt-green)]">
                Manages {projectsDirValidation.repoCount}{' '}
                {projectsDirValidation.repoCount === 1 ? 'repo' : 'repos'} in this folder
              </div>
            )}
          {projectsDirValidation &&
            !projectsDirValidation.ok &&
            projectsDirValidation.reason === 'is-repo' && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10.5px] text-amber-200">
                <span className="min-w-0 flex-1">{projectsDirValidation.message}</span>
                {projectsDirValidation.suggestedParent && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() =>
                      saveDaemon({
                        projectsDir: projectsDirValidation.suggestedParent || '',
                      })
                    }
                    className="border-amber-400/40 bg-black/20 font-semibold text-amber-100 hover:bg-amber-400/10"
                  >
                    Use parent
                  </Button>
                )}
              </div>
            )}
          {!selectedIsRemote &&
            projectsDirValidation &&
            !projectsDirValidation.ok &&
            projectsDirValidation.reason === 'no-repos-found' && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10.5px] text-amber-200">
                <span className="min-w-0 flex-1">
                  0 repos found here — they may be nested one level deeper.
                </span>
                {projectsDirValidation.suggestedChild && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() =>
                      saveDaemon({
                        projectsDir: projectsDirValidation.suggestedChild || '',
                      })
                    }
                    className="border-amber-400/40 bg-black/20 font-semibold text-amber-100 hover:bg-amber-400/10"
                  >
                    Use {projectsDirValidation.suggestedChild} (
                    {projectsDirValidation.suggestedCount}{' '}
                    {projectsDirValidation.suggestedCount === 1 ? 'repo' : 'repos'})
                  </Button>
                )}
              </div>
            )}
          <EditDetails>
            <Input
              key={`${profile}-projectsDir-${selectedDaemon.projectsDir}`}
              defaultValue={selectedDaemon.projectsDir}
              onBlur={(e) =>
                e.target.value !== selectedDaemon.projectsDir &&
                saveDaemon({ projectsDir: e.target.value.trim() })
              }
              placeholder={selectedIsRemote ? '~/projects' : '/path/to/projects'}
              spellCheck={false}
              className="font-mono"
            />
          </EditDetails>
        </PathSetting>
        <PathSetting
          label="Worktrees directory"
          value={selectedDaemon.worktreesDir}
          fallback={`${tilde(selectedDaemon.projectsDir) || '<projects>'}/.worktrees`}
          detail="Agent process worktrees are created here."
          onBrowse={selectedIsRemote ? undefined : () => browseDaemon('worktreesDir')}
          onClear={() => saveDaemon({ worktreesDir: '' })}
        >
          <EditDetails>
            <Input
              key={`${profile}-worktreesDir-${selectedDaemon.worktreesDir}`}
              defaultValue={selectedDaemon.worktreesDir}
              onBlur={(e) =>
                e.target.value !== selectedDaemon.worktreesDir &&
                saveDaemon({ worktreesDir: e.target.value.trim() })
              }
              placeholder={selectedIsRemote ? '~/.worktrees' : '/path/to/worktrees'}
              spellCheck={false}
              className="font-mono"
            />
          </EditDetails>
        </PathSetting>
        <PathSetting
          label="Template repository"
          value={selectedDaemon.templateRepo}
          fallback="trevormil/project-template"
          detail="Used when creating a new project from template."
          onClear={() => saveDaemon({ templateRepo: '' })}
        >
          <EditDetails>
            <Input
              key={`${profile}-templateRepo-${selectedDaemon.templateRepo}`}
              defaultValue={selectedDaemon.templateRepo}
              onBlur={(e) =>
                e.target.value !== selectedDaemon.templateRepo &&
                saveDaemon({ templateRepo: e.target.value.trim() })
              }
              placeholder="owner/repo or https://github.com/owner/repo"
              spellCheck={false}
              className="font-mono"
            />
          </EditDetails>
        </PathSetting>
        <PathSetting
          label="Harness directory"
          value={selectedDaemon.harnessDir}
          fallback="Not set"
          detail="Optional review artifact harness path."
          onBrowse={selectedIsRemote ? undefined : () => browseDaemon('harnessDir')}
          onClear={() => saveDaemon({ harnessDir: '' })}
        >
          <EditDetails>
            <Input
              key={`${profile}-harnessDir-${selectedDaemon.harnessDir}`}
              defaultValue={selectedDaemon.harnessDir}
              onBlur={(e) =>
                e.target.value !== selectedDaemon.harnessDir &&
                saveDaemon({ harnessDir: e.target.value.trim() })
              }
              placeholder={selectedIsRemote ? '~/autopilot-harness' : '/path/to/autopilot-harness'}
              spellCheck={false}
              className="font-mono"
            />
          </EditDetails>
        </PathSetting>
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => window.gt.openConfigDir()}
            title="Reveal ~/.config/TerMinal/ in Finder — edit schedules.json, settings.json, or agent-state/ sidecars by hand"
          >
            Open TerMinal config dir
          </Button>
          <span className="text-[10.5px] text-zinc-600">
            schedules · settings · cron logs · agent state
          </span>
        </div>
        <div className="mt-2 rounded-lg border border-[var(--gt-border)] bg-black/20 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                TerMinal storage
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-300">
                {storage ? (
                  `${formatBytes(storage.totalBytes)} total · ${formatBytes(storage.reclaimableBytes)} reclaimable`
                ) : storageBusy === 'scan' ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    Scanning storage…
                  </>
                ) : (
                  'Dry-run estimate not loaded'
                )}
              </div>
              {storage && (
                <div className="mt-0.5 text-[10.5px] leading-snug text-zinc-600">
                  Cron worktrees {formatBytes(storage.worktrees.bytes)} · agent worktrees{' '}
                  {formatBytes(storage.agentWorktrees.bytes)} · checkpoints{' '}
                  {formatBytes(storage.checkpoints.bytes)} · scratch{' '}
                  {formatBytes(storage.scratch.bytes)} · logs {formatBytes(storage.logs.bytes)} ·
                  leftovers {formatBytes(storage.leftovers.bytes)}
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void refreshStorage()}
              disabled={storageBusy !== null}
              aria-busy={storageBusy === 'scan' || undefined}
            >
              {storageBusy === 'scan' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw strokeWidth={2} />
              )}
              Dry-run estimate
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void reclaimStorage()}
              disabled={storageBusy !== null || !storage || storage.reclaimableBytes === 0}
              aria-busy={storageBusy === 'reclaim' || undefined}
              title="Deletes worktrees past the size or 30-day age budget, checkpoint stores untouched for 90 days, stale temp/lock/quarantine files; rotates oversized logs; then runs git gc on large checkpoint stores. Running worktrees and worktrees with uncommitted changes are never touched."
            >
              {storageBusy === 'reclaim' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 strokeWidth={2} />
              )}
              Reclaim leaked state
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void clearScratch()}
              disabled={storageBusy !== null || !storage?.scratch.clearable}
              aria-busy={storageBusy === 'scratch' || undefined}
              title="Explicitly deletes ~/.config/TerMinal/scratch. This is separate from leaked-state reclaim."
            >
              {storageBusy === 'scratch' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 strokeWidth={2} />
              )}
              Clear scratch
            </Button>
          </div>
        </div>
      </div>
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'paths',
  title: 'Paths',
  icon: FolderTree,
  order: 1,
  Component,
}
export default section
