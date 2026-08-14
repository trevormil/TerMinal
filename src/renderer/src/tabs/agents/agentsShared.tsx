import type { ReactNode } from 'react'
import type { Extension } from '@codemirror/state'
import {
  Bot,
  Brain,
  BookText,
  ScanSearch,
  ListChecks,
  TestTube2,
  ShieldAlert,
  Gauge,
  PackageCheck,
  Eraser,
  MessageSquare,
  ClipboardList,
  Footprints,
  Swords,
  Telescope,
  Target,
  Lock,
  Languages,
  ScrollText,
  Scissors,
  MessageCircleQuestion,
  Recycle,
  Library,
  Newspaper,
  Factory,
  Wrench,
  Workflow,
  RadioTower,
  AlertOctagon,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import type { BadgeTone } from '../../components/ui'
import { langExtensionFor } from '../../lib/lazyLang'
import { agentFileLangKey } from '../../lib/agentsView'

// Presentation atoms shared by the Agents tab's list, detail, and editor
// modules: the icon registry a spec's `icon` string resolves through, the
// source→badge map, the section heading, the stat tile, and the one input
// class every modal field uses. Pure shaping lives in lib/agentsView.ts.

export const AGENT_ICON: Record<string, LucideIcon> = {
  BookText,
  ScanSearch,
  ListChecks,
  TestTube2,
  ShieldAlert,
  Gauge,
  PackageCheck,
  Eraser,
  Factory,
  Wrench,
  MessageSquare,
  ClipboardList,
  Footprints,
  Swords,
  Telescope,
  Target,
  Lock,
  Languages,
  ScrollText,
  Scissors,
  MessageCircleQuestion,
  Recycle,
  Library,
  Newspaper,
  Workflow,
  RadioTower,
  AlertOctagon,
  Undo2,
  Brain,
  Bot,
}

export const SOURCE: Record<string, { label: string; tone: BadgeTone }> = {
  default: { label: 'Default', tone: 'mute' },
  'repo-override': { label: 'Repo override', tone: 'yellow' },
  'global-override': { label: 'Global override', tone: 'blue' },
  repo: { label: 'Custom', tone: 'accent' },
  global: { label: 'Global', tone: 'blue' },
  persistent: { label: 'Persistent', tone: 'accent' },
}

export function SectionKicker({
  icon: Icon,
  title,
  meta,
}: {
  icon?: LucideIcon
  title: string
  meta?: ReactNode
}) {
  return (
    <div className="mb-3 flex min-w-0 items-center gap-2">
      {Icon && (
        <Icon size={13} strokeWidth={2.5} className="shrink-0 text-[var(--gt-accent-light)]" />
      )}
      <h3 className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      {meta}
    </div>
  )
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-[var(--gt-border)]/60 px-2 py-1.5">
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">{label}</div>
      <div className={`font-mono text-[12.5px] ${tone || 'text-zinc-300'}`}>{value}</div>
    </div>
  )
}

export const FIELD =
  'w-full rounded-lg border border-[var(--gt-border)] bg-black/30 px-2 py-1.5 text-[12px] text-zinc-200 outline-none focus:border-[var(--gt-accent)]/60'

export function langForAgentFile(path: string): Extension[] {
  return langExtensionFor(agentFileLangKey(path))
}
