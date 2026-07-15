import { useState } from 'react'
import { Sparkles, ChevronRight, ChevronDown } from 'lucide-react'
import { Card, CopyButton, Empty } from '../../components/ui'
import type { Plugin, SkillInfo } from '../../lib/types'

function SkillRow({ s }: { s: SkillInfo }) {
  const command = `/${s.scope === 'plugin' && s.namespace ? `${s.namespace}:` : ''}${s.name}`
  return (
    <div className="border-b border-[var(--gt-border)]/30 py-1.5 last:border-0">
      <div className="font-mono text-[11px] text-zinc-200">
        <CopyButton value={command} title={`Copy ${command} — paste in terminal`}>
          {s.scope === 'plugin' && s.namespace ? (
            <span className="text-zinc-500">{s.namespace}:</span>
          ) : null}
          {s.name}
        </CopyButton>
        {s.platforms?.length ? (
          <span className="ml-1 text-[9px] text-zinc-600">{s.platforms.join('+')}</span>
        ) : null}
      </div>
      {s.description && (
        <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-zinc-500">
          {s.description}
        </div>
      )}
    </div>
  )
}

// Cockpit widget: "our" skills (project + personal) always shown; the larger set
// of installed-plugin skills is collapsed behind an expand toggle.
function SkillsCard({ data }: { data: SkillInfo[] | null }) {
  const [showPlugins, setShowPlugins] = useState(false)
  if (!data) return null
  const ours = data.filter((s) => s.scope === 'project' || s.scope === 'personal')
  const plugins = data.filter((s) => s.scope === 'plugin')

  if (ours.length === 0 && plugins.length === 0)
    return (
      <Card icon={Sparkles} title="Skills">
        <Empty>No skills found</Empty>
      </Card>
    )

  return (
    <Card icon={Sparkles} title={`Skills · ${ours.length + plugins.length}`}>
      <div className="max-h-72 overflow-y-auto pr-1">
        {ours.length > 0 ? (
          ours.map((s) => <SkillRow key={`${s.scope}:${s.name}`} s={s} />)
        ) : (
          <div className="py-1 text-[10.5px] text-zinc-600">
            No project or personal skills — see plugin skills below.
          </div>
        )}
        {plugins.length > 0 && (
          <>
            <button
              onClick={() => setShowPlugins((v) => !v)}
              className="mt-1.5 flex w-full items-center gap-1 py-1 text-[10.5px] text-zinc-500 hover:text-zinc-300"
            >
              {showPlugins ? (
                <ChevronDown size={11} strokeWidth={2} />
              ) : (
                <ChevronRight size={11} strokeWidth={2} />
              )}
              {showPlugins ? 'Hide' : 'Show'} {plugins.length} plugin skills
            </button>
            {showPlugins && plugins.map((s) => <SkillRow key={`${s.namespace}:${s.name}`} s={s} />)}
          </>
        )}
      </div>
    </Card>
  )
}

const plugin: Plugin<SkillInfo[]> = {
  id: 'skills',
  title: 'Skills',
  icon: Sparkles,
  blurb:
    'Browse available Claude/Codex/Cursor skills — your project + personal skills first, plugin skills on expand.',
  order: 9,
  intervalMs: 15_000,
  defaultEnabled: true,
  poll: (gt) => gt.listSkills(),
  render: (d) => <SkillsCard data={d} />,
}
export default plugin
