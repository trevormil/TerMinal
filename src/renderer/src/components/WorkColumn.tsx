import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  FolderTree,
  LayoutGrid,
  RotateCw,
  type LucideIcon,
} from 'lucide-react'
import { FileTree, type FileTreeActions } from './FileTree'
import { FileModal } from './FileModal'
import { PluginWidget } from './PluginWidget'
import { CardChromeProvider } from './ui'
import { SECTION_PLUGINS } from '../plugins/registry'
import { readCollapsed, sectionCollapseKey, writeCollapsed } from '../lib/panelCollapse'
import { initialSectionCollapsed } from '../lib/workColumn'
import type { FileEntry, Plugin, TabContext } from '../lib/types'

/**
 * The Terminal tab's work column: ONE accordion down the right edge —
 * Files · Tickets · PRs / MRs · Cockpit — each section independently
 * collapsible, several open at once. That last property is the whole point;
 * this is deliberately not a tab strip, which would force a choice between
 * them.
 *
 * Cockpit is the old standalone panel, folded in. It is one section holding the
 * entire widget stack, all visible at once when expanded — NOT a second, nested
 * accordion. Widgets are still enabled/disabled/reordered in the Plugins
 * drawer; this only renders what that drawer decided.
 *
 * Tickets and PRs/MRs are the same `Plugin` specs as any widget, promoted to
 * their own sections by `partitionPluginHosts`. The partition is what keeps
 * each plugin mounted exactly once — tickets polls every 5s, and a double
 * mount would double that forever.
 *
 * Height model: SIZE-TO-CONTENT, not drag-to-resize. Tickets and PRs/MRs take
 * the height their content wants; Files and Cockpit split the remainder and
 * scroll internally. No per-section drag handles and no persisted heights —
 * one less thing to store and get wrong.
 */

/** Persisted per-section collapse, keyed by section id (extends panelCollapse). */
function useSectionCollapse(sectionId: string, whenUnset: boolean) {
  const key = sectionCollapseKey(sectionId)
  const [collapsed, setCollapsed] = useState(() => readCollapsed(key, whenUnset))
  useEffect(() => writeCollapsed(key, collapsed), [key, collapsed])
  return [collapsed, () => setCollapsed((c) => !c)] as const
}

/**
 * The one right-flexed affordance a section header can carry (Files' refresh,
 * Cockpit's plugin drawer). One component so every section action is the same
 * size, colour and hover — and so a click can never fall through to the header
 * row underneath, which is the collapse toggle.
 */
function SectionAction({
  icon: Icon,
  title,
  onClick,
  /** Needs attention — draws a dot. Never the ONLY place that dot appears: a
      collapsed section or column would hide it. See trustDotVisible. */
  alert,
  alertLabel,
}: {
  icon: LucideIcon
  title: string
  onClick: () => void
  alert?: boolean
  alertLabel?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`relative flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-white/5 hover:text-zinc-300 ${
        alert ? 'text-[var(--gt-red)]' : 'text-zinc-600'
      }`}
    >
      <Icon size={11} strokeWidth={2} />
      {alert && (
        // Decorative: this button's `title` already carries the full
        // explanation, so labelling the dot too gave the control TWO accessible
        // names — and made it indistinguishable from the identical dot on the
        // column toggle, which is a different control doing a different job.
        <span
          aria-hidden="true"
          data-alert-label={alertLabel}
          className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--gt-red)]"
        />
      )}
    </button>
  )
}

function Section({
  icon: Icon,
  title,
  count,
  collapsed,
  onToggle,
  actions,
  /** This section splits the column's leftover height (Files and Cockpit do). */
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
        <SectionAction
          icon={RotateCw}
          title="Refresh files"
          onClick={() => setVersion((v) => v + 1)}
        />
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
          {/* The plugin renders a titled Card in the Cockpit stack; in here the
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

/**
 * The cockpit, as one section: every enabled widget, boxed, stacked, all
 * visible at once. Deliberately NOT nested accordions — being able to sweep the
 * whole set of live session signals in one glance is the reason the cockpit was
 * worth keeping.
 */
function CockpitSection({
  widgets,
  onHide,
  onEnableDefaults,
  onOpenPlugins,
  trustPending,
}: {
  widgets: Plugin[]
  onHide: (id: string) => void
  onEnableDefaults: () => void
  onOpenPlugins: () => void
  trustPending: boolean
}) {
  const [collapsed, toggle] = useSectionCollapse('cockpit', false)
  return (
    <Section
      icon={Activity}
      title="Cockpit"
      count={widgets.length || null}
      collapsed={collapsed}
      onToggle={toggle}
      grow
      actions={
        <SectionAction
          icon={LayoutGrid}
          title={
            trustPending
              ? 'This repo’s widgets need your approval before they can run — open Plugins to read them'
              : 'Plugins'
          }
          onClick={onOpenPlugins}
          alert={trustPending}
          alertLabel="Repo widgets need approval"
        />
      }
    >
      {widgets.length === 0 ? (
        <div className="m-2 rounded-xl border border-dashed border-[var(--gt-border)] p-3 text-center text-[11px] text-zinc-600">
          No widgets enabled.
          <button
            onClick={onEnableDefaults}
            className="mx-auto mt-2 block rounded-md border border-[var(--gt-border)] bg-[var(--gt-panel)] px-3 py-1 text-[11px] font-medium text-zinc-300 hover:border-[var(--gt-accent)]/60 hover:text-white"
          >
            Enable defaults
          </button>
        </div>
      ) : (
        // Vertical rhythm comes from each Card's own bottom margin, not from a
        // gap here — a widget that renders nothing this poll then collapses to
        // zero height (its PluginWidget wrapper has no insets of its own)
        // rather than leaving a phantom band in the middle of the stack. The
        // 6px of top padding is the only inset this div owns, and it has no
        // border or background, so an all-quiet stack shows nothing at all.
        <div className="px-2 pt-1.5">
          {widgets.map((p) => (
            <PluginWidget key={p.id} plugin={p} onHide={onHide} />
          ))}
        </div>
      )}
    </Section>
  )
}

export function WorkColumn({
  ctx,
  active,
  known,
  enabled,
  widgets,
  onHideWidget,
  onEnableDefaults,
  onOpenPlugins,
  trustPending,
}: {
  /** Null until the session reports its workspace; only Files needs it. */
  ctx: TabContext | null
  /** Only the focused session hosts the polling sections. */
  active: boolean
  /** Widget prefs, read once to seed each promoted section's collapse state. */
  known: string[]
  enabled: string[]
  /** Enabled widgets, in the user's order, for the Cockpit section. */
  widgets: Plugin[]
  onHideWidget: (id: string) => void
  onEnableDefaults: () => void
  /** Opens the Plugins drawer, where widgets are managed and repo trust is
      approved. This section header is the only button-shaped route to it. */
  onOpenPlugins: () => void
  /** Repo widgets are waiting on approval — dot the Plugins action. The header's
      column toggle carries the same dot, so collapsing this away loses nothing. */
  trustPending: boolean
}) {
  const [filesCollapsed, toggleFiles] = useSectionCollapse('files', false)
  // A remote session, or one that hasn't resolved a workspace, has no tree to
  // show — the other three sections still make sense, so the column stays.
  const showFiles = !!ctx && !!(ctx.repoRoot || ctx.cwd)
  return (
    <aside className="flex min-w-0 flex-col overflow-hidden border-l border-[var(--gt-border)] bg-[var(--gt-bg)]">
      {/* No title row: the four section headers already name everything in
          here, and hiding the column is a one-click affordance in the session
          chrome. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {showFiles && ctx && (
          <FilesSection ctx={ctx} collapsed={filesCollapsed} onToggle={toggleFiles} />
        )}
        {/* Polling sections mount only for the focused session — otherwise every
            backgrounded tab would keep polling. Files is exempt: it lists once
            on mount and never polls, so a backgrounded session costs one IPC. */}
        {active && (
          <>
            {SECTION_PLUGINS.map((p) => (
              <PluginSection key={p.id} plugin={p} known={known} enabled={enabled} />
            ))}
            <CockpitSection
              widgets={widgets}
              onHide={onHideWidget}
              onEnableDefaults={onEnableDefaults}
              onOpenPlugins={onOpenPlugins}
              trustPending={trustPending}
            />
          </>
        )}
      </div>
    </aside>
  )
}
