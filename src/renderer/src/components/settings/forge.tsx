import { GitPullRequest } from 'lucide-react'
import type { ForgePref } from '../../lib/types'
import { Readiness, Section, type SettingsCtx, type SettingsSectionSpec } from './shared'

function Component({ ctx }: { ctx: SettingsCtx }) {
  const { env, selectedIsRemote, selectedProbe, selectedDaemon, saveDaemon } = ctx
  const forgeOpt = (val: ForgePref, label: string, hint: string) => (
    <button
      key={val}
      onClick={() => saveDaemon({ forge: val })}
      className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
        selectedDaemon.forge === val
          ? 'border-[var(--gt-accent)] bg-[var(--gt-accent)]/20 text-zinc-100'
          : 'border-[var(--gt-border)] text-zinc-400 hover:border-[var(--gt-accent)]/50'
      }`}
    >
      <div className="text-[12px] font-semibold">{label}</div>
      <div className="text-[10.5px] text-zinc-500">{hint}</div>
    </button>
  )

  return (
    <Section
      id="forge"
      icon={GitPullRequest}
      title="Code forge"
      desc="Auto picks gh for GitHub remotes and glab otherwise — per repo."
    >
      <div className="flex gap-2">
        {forgeOpt('auto', 'Auto', 'detect per repo')}
        {forgeOpt('github', 'GitHub', 'force gh / PRs')}
        {forgeOpt('gitlab', 'GitLab', 'force glab / MRs')}
      </div>
      {selectedIsRemote && selectedProbe && !('loading' in selectedProbe) ? (
        <div className="mt-3 space-y-1">
          <Readiness
            ok={!!selectedProbe.tools.gh}
            name="gh"
            hint={selectedProbe.tools.gh || 'not detected on remote PATH'}
          />
          <Readiness
            ok={!!selectedProbe.tools.glab}
            name="glab"
            hint={selectedProbe.tools.glab || 'not detected on remote PATH'}
          />
        </div>
      ) : (
        env && (
          <div className="mt-3 space-y-1">
            <Readiness
              ok={env.gh.found && env.gh.authed}
              name="gh"
              hint={
                env.gh.found
                  ? env.gh.authed
                    ? `authenticated${env.gh.authHost ? ` (${env.gh.authHost})` : ''}`
                    : 'installed — run `gh auth login`'
                  : 'not installed — `brew install gh`'
              }
            />
            <Readiness
              ok={env.glab.found && env.glab.authed}
              name="glab"
              hint={
                env.glab.found
                  ? env.glab.authed
                    ? `authenticated${env.glab.authHost ? ` (${env.glab.authHost})` : ''}`
                    : 'installed — run `glab auth login`'
                  : 'not installed — `brew install glab`'
              }
            />
          </div>
        )
      )}
    </Section>
  )
}

const section: SettingsSectionSpec = {
  id: 'forge',
  title: 'Forge',
  icon: GitPullRequest,
  order: 5,
  Component,
}
export default section
