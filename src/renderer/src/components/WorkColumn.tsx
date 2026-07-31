import { useEffect, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  PanelLeftClose,
  RotateCw,
  type LucideIcon,
} from 'lucide-react'
import { FileTree, type FileTreeActions } from './FileTree'
import { FileModal } from './FileModal'
import { PluginWidget } from './PluginWidget'
import { CardChromeProvider } from './ui'
import { COLUMN_PLUGINS } from '../plugins/registry'
import { readCollapsed, sectionCollapseKey, writeCollapsed } from '../lib/panelCollapse'
import { initialSectionCollapsed } from '../lib/workColumn'
import type { FileEntry, Plugin, TabContext } from '../lib/types'

/**
 * The Terminal tab's work column: a VS Code-style accordion of independently
 * collapsible sections — Files, Tickets, PRs / MRs — down the left edge, so you
 * can glance at the backlog without losing your place in the tree. Several
 * sections open at once is the entire point; this is deliberately not a tab
 * strip, which would force a choice between them.
 *
 * Tickets and PRs/MRs are the EXISTING cockpit plugins, hosted here rather than
 * reimplemented: the accordion is a second host for the `Plugin` contract, and
 * `PluginWidget` supplies the poll loop either way. They are filtered out of the
 * cockpit's registry (`COCKPIT_PLUGINS`), so exactly one host mounts each —
 * tickets polls every 5s, and a double-mount would double that forever.
 *
 * Height model: SIZE-TO-CONTENT, not drag-to-resize. Plugin sections take the
 * height their content wants and shrink when the column runs short; Files
 * absorbs the remainder above a floor and scrolls internally. No per-section
 * drag handles and no persisted heights — one less thing to store and get wrong.
 */

/** Persisted per-section collapse, keyed by section id (extends panelCollapse). */
function useSectionCollapse(sectionId: string, whenUnset: boolean) {
  const key = sectionCollapseKey(sectionId)
  const [collapsed, setCollapsed] = useState(() => readCollapsed(key, whenUnset))
  useEffect(() => writeCollapsed(key, collapsed), [key, collapsed])
  return [collapsed, () => setCollapsed((c) => !c)] as const
}

function Section({
  icon: Icon,
  title,
  count,
  collapsed,
  onToggle,
  actions,
  /** This section absorbs the column's leftover height (Files does). */
  grow,
  children,
}: {
  icon: LucideIcon
  title: string
  count?: number | null
  collapsed: boolean
  onToggle: () => void
  actions?: ReactNode
  grow?: boolean
  children: ReactNode
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <section
      className={`flex min-h-0 flex-col ${
        collapsed ? 'shrink-0' : grow ? 'min-h-[120px] flex-1' : 'shrink'
      }`}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-1.5 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? `Show ${title}` : `Hide ${title}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gt-accent-2)]"
        >
          <Chevron size={11} strokeWidth={2.5} className="shrink-0 text-zinc-600" />
          <Icon size={11} strokeWidth={2.25} className="shrink-0 text-zinc-600" />
          <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            {title}
          </span>
          {/* Absent, not zero, when there is nothing to count: a section that
              hasn't polled yet, or errored, shows no pill rather than a "· 0"
              that reads as real data. */}
          {count != null && (
            <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">· {count}</span>
          )}
        </button>
        {actions}
      </div>
      {/* Hidden, not unmounted. A collapsed plugin section keeps its count live
          in the header and keeps per-widget state (paging, open modal) across a
          collapse — and the poll loop stays in exactly one place. */}
      <div className={collapsed ? 'hidden' : 'flex min-h-0 flex-1 flex-col overflow-y-auto'}>
        {children}
      </div>
    </section>
  )
}

/**
 * Browse the workspace, open a file in a modal editor, or drag a row onto the
 * terminal to hand its path to the agent — all without leaving the tab.
 *
 * Read-only on purpose. Create/rename/delete/compare stay in the Files tab; the
 * shared tree renders only the affordances a surface actually passes, so this
 * one shows copy-path and reveal and nothing else.
 */
function FilesSection({
  ctx,
  collapsed,
  onToggle,
}: {
  ctx: TabContext
  collapsed: boolean
  onToggle: () => void
}) {
  const [roots, setRoots] = useState<FileEntry[] | null>(null)
  const [version, setVersion] = useState(0)
  const [selectedDir, setSelectedDir] = useState('')
  const [openPath, setOpenPath] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRoots(null)
    window.gt.files
      .list('')
      .then((r) => alive && setRoots(r))
      .catch(() => alive && setRoots([]))
    return () => {
      alive = false
    }
  }, [ctx.repoRoot, version])

  const act: FileTreeActions = {
    onOpen: setOpenPath,
    onSelectDir: setSelectedDir,
    absFor: (p) => {
      const root = ctx.repoRoot || ctx.cwd || ''
      return root ? `${root}/${p}` : p
    },
  }

  return (
    <Section
      icon={FolderTree}
      title="Files"
      collapsed={collapsed}
      onToggle={onToggle}
      grow
      actions={
        <button
          onClick={() => setVersion((v) => v + 1)}
          title="Refresh files"
          className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
        >
          <RotateCw size={11} strokeWidth={2} />
        </button>
      }
    >
      <FileTree
        roots={roots}
        active={openPath}
        selectedDir={selectedDir}
        version={version}
        act={act}
      />
      {openPath && <FileModal path={openPath} onClose={() => setOpenPath(null)} />}
    </Section>
  )
}

function PluginSection({
  plugin,
  known,
  enabled,
}: {
  plugin: Plugin
  known: string[]
  enabled: string[]
}) {
  const [collapsed, toggle] = useSectionCollapse(
    plugin.id,
    initialSectionCollapsed(plugin.id, plugin.defaultEnabled, known, enabled),
  )
  return (
    <PluginWidget
      plugin={plugin}
      chrome={(body, data) => (
        <Section
          icon={plugin.icon}
          title={plugin.title}
          count={plugin.count?.(data) ?? null}
          collapsed={collapsed}
          onToggle={toggle}
        >
          {/* The plugin renders a titled Card for the cockpit; in here the
              section header IS that title, so Card drops its own frame.
              `empty:hidden` because a plugin that renders nothing (mr-summary
              before its first poll) would otherwise leave this div's insets
              behind as phantom padding under the header. */}
          <div className="px-2 py-1.5 empty:hidden">
            <CardChromeProvider chrome="bare">{body}</CardChromeProvider>
          </div>
        </Section>
      )}
    />
  )
}

export function WorkColumn({
  ctx,
  onCollapse,
  active,
  known,
  enabled,
}: {
  ctx: TabContext
  onCollapse: () => void
  /** Only the focused session hosts the polling sections. */
  active: boolean
  /** Legacy cockpit prefs, read once to seed each migrated section's state. */
  known: string[]
  enabled: string[]
}) {
  const [filesCollapsed, toggleFiles] = useSectionCollapse('files', false)
  return (
    <aside className="flex min-w-0 flex-col overflow-hidden border-r border-[var(--gt-border)] bg-[var(--gt-bg)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--gt-border)] px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">
          Work
        </span>
        <button
          onClick={onCollapse}
          title="Hide work column"
          className="flex h-5 w-5 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-white/5 hover:text-zinc-300"
        >
          <PanelLeftClose size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <FilesSection ctx={ctx} collapsed={filesCollapsed} onToggle={toggleFiles} />
        {/* Plugin sections mount only for the focused session, mirroring the
            cockpit — otherwise every backgrounded tab would keep polling. */}
        {active &&
          COLUMN_PLUGINS.map((p) => (
            <PluginSection key={p.id} plugin={p} known={known} enabled={enabled} />
          ))}
      </div>
    </aside>
  )
}
