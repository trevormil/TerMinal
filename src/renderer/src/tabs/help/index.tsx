import {
  LifeBuoy,
  Play,
  Ticket as TicketIcon,
  GitBranch,
  FlaskConical,
  ScanSearch,
  GitMerge,
  RefreshCw,
  Radar,
  Layers,
  FileText,
  Bell,
  FlagTriangleRight,
  SquareTerminal,
  LayoutGrid,
  type LucideIcon,
} from 'lucide-react'
import type { Tab, TabContext } from '../../lib/types'

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-zinc-300">
        <Icon size={14} strokeWidth={2.25} className="text-[var(--gt-accent-2)]" />
        {title}
      </h2>
      {children}
    </section>
  )
}

// One numbered step on the workflow rail.
function LoopStep({
  n,
  icon: Icon,
  cmd,
  children,
}: {
  n: number
  icon: LucideIcon
  cmd: string
  children: React.ReactNode
}) {
  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      <div className="relative flex w-6 shrink-0 justify-center">
        <span className="absolute top-6 bottom-0 left-1/2 w-px -translate-x-1/2 bg-[var(--gt-border)]/70" />
        <span className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--gt-accent)]/40 bg-[var(--gt-panel)] text-[10px] font-bold text-[var(--gt-accent-light)]">
          {n}
        </span>
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-1.5">
          <Icon size={12} strokeWidth={2} className="text-zinc-500" />
          <code className="font-mono text-[12px] text-[var(--gt-accent-light)]">{cmd}</code>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-zinc-400">{children}</p>
      </div>
    </div>
  )
}

function SkillCard({ cmd, when, children }: { cmd: string; when: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--gt-border)] bg-[var(--gt-panel)] p-3">
      <code className="font-mono text-[12px] font-semibold text-[var(--gt-accent-light)]">{cmd}</code>
      <p className="mt-1 text-[11.5px] leading-snug text-zinc-400">{children}</p>
      <p className="mt-1.5 text-[10.5px] uppercase tracking-wide text-zinc-600">When · {when}</p>
    </div>
  )
}

function Rule({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Icon size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--gt-accent-2)]" />
      <p className="text-[12px] leading-snug text-zinc-400">
        <span className="font-semibold text-zinc-200">{title} — </span>
        {children}
      </p>
    </div>
  )
}

function HelpTab(_props: { ctx: TabContext }) {
  return (
    <div className="h-full overflow-y-auto bg-[var(--gt-bg)]">
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* hero */}
        <div className="mb-8 border-b border-[var(--gt-border)] pb-6">
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
            <LifeBuoy size={20} strokeWidth={2} className="text-[var(--gt-accent)]" />
            Developer Guide
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
            Gauntlet Terminal wraps the real <code className="font-mono text-zinc-300">claude</code> CLI with a
            per-session cockpit. A repo scaffolded from <span className="text-zinc-200">project-template</span>{' '}
            ships an agent-driven SDLC: you (or an agent) move work from idea → ticket → branch → PR → review,
            and <span className="font-semibold text-zinc-200">you</span> do the final merge. This is the loop and
            the tools to wield it.
          </p>
        </div>

        <Section icon={RefreshCw} title="The loop">
          <div className="rounded-xl border border-[var(--gt-border)] bg-[var(--gt-panel)]/40 p-4">
            <LoopStep n={1} icon={Play} cmd="/session-start">
              Open a session — seeds a live <code className="font-mono">sessions/NNNN/session.md</code> by scanning
              the repo for in-scope tickets, prior work, and tools.
            </LoopStep>
            <LoopStep n={2} icon={TicketIcon} cmd="/ticket">
              Capture work as backlog tickets (<code className="font-mono">backlog/NNNN-slug.md</code>) — or pick
              one from the <span className="text-zinc-300">Tickets</span> tab.
            </LoopStep>
            <LoopStep n={3} icon={GitBranch} cmd="/pr-creation">
              Branch (optionally a worktree) → implement TDD-first → push → open the PR/MR → link it back into the
              ticket. Stops at "PR is open" — review is a separate step.
            </LoopStep>
            <LoopStep n={4} icon={FlaskConical} cmd="/test-suite">
              The cheap inner loop between commits: run tests, report to chat, no artifact.
            </LoopStep>
            <LoopStep n={5} icon={ScanSearch} cmd="/code-review">
              The checkpoint: Codex runs the suite (the gate), scores six axes, and writes one combined artifact
              to <code className="font-mono">.reviews/</code>. Runs in the background — keep working.
            </LoopStep>
            <LoopStep n={6} icon={GitMerge} cmd="you merge">
              When it hits the bar, <span className="font-semibold text-zinc-200">you</span> merge. Agents never
              push or merge to main — that gate is human-only.
            </LoopStep>
            <LoopStep n={7} icon={RefreshCw} cmd="/merge-sync → /session-end">
              Reconcile: close merged tickets + scrub their PR URLs, then end the session (cleanup, refactor pass,
              capture docs).
            </LoopStep>
          </div>
        </Section>

        <Section icon={LayoutGrid} title="Skills you'll use">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <SkillCard cmd="/session-start" when="starting work">
              Opens a session and seeds a live session doc from a repo scan.
            </SkillCard>
            <SkillCard cmd="/ticket" when="capturing work">
              Create / list / update / close backlog tickets with valid frontmatter.
            </SkillCard>
            <SkillCard cmd="/pr-creation" when="implementing a ticket">
              Ticket → branch → TDD implementation → pushed PR/MR, linked back to the ticket.
            </SkillCard>
            <SkillCard cmd="/test-suite" when="between commits">
              Ad-hoc Codex test run reported to chat — the fast inner loop.
            </SkillCard>
            <SkillCard cmd="/code-review" when="a PR is ready">
              Codex: tests-as-gate + six-axis score + findings, written to <code className="font-mono">.reviews/</code>.
            </SkillCard>
            <SkillCard cmd="/check" when="weekly / on cadence">
              Repo-level inspection (dead-code, dep drift) → dated <code className="font-mono">.checks/</code> artifact.
            </SkillCard>
            <SkillCard cmd="/stacked-mr" when="AFK / overnight batch">
              Stack a queue of tickets as dependent PRs, then batch-review the whole stack at the end.
            </SkillCard>
            <SkillCard cmd="/document" when="after a decision">
              Propose ADRs / runbooks / learnings / architecture updates from recent changes.
            </SkillCard>
            <SkillCard cmd="/merge-sync" when="after a human merge">
              Close merged tickets and scrub merged PR URLs from <code className="font-mono">prs:</code>.
            </SkillCard>
            <SkillCard cmd="/notify" when="going AFK">
              Two-way Telegram bridge: completion/blocker pings + replies that wake the session.
            </SkillCard>
          </div>
          <p className="mt-2.5 text-[11px] text-zinc-600">
            The <span className="text-zinc-400">Skills</span> cockpit widget lists every skill available here —
            your project + personal skills first, installed-plugin skills on expand.
          </p>
        </Section>

        <Section icon={SquareTerminal} title="Around the app">
          <div className="space-y-1.5 text-[12px] leading-snug text-zinc-400">
            <p>
              <span className="font-semibold text-zinc-200">Tabs (top bar):</span> Terminal is the live{' '}
              <code className="font-mono">claude</code> session. Tickets browses the backlog; MRs/PRs lists changes
              with their review verdicts (filter Open/Merged/Closed/All); Agents shows spawned runs; HITL collects
              anything waiting on you; Activity is the live event feed; Notes / Files / Sessions round it out.
            </p>
            <p>
              <span className="font-semibold text-zinc-200">Cockpit (right, the Plugins button):</span> live widgets
              — context window, usage + burn-rate, TDD status, git, todos, open-PR summary, and Skills. Toggle any
              of them from the Plugins drawer; the × on a widget hides it.
            </p>
          </div>
        </Section>

        <Section icon={FlagTriangleRight} title="The rules that matter">
          <div className="space-y-2.5">
            <Rule icon={GitMerge} title="Merge bar">
              A PR is mergeable at <span className="text-zinc-200">approve + tests pass + 0 findings ≥ medium</span>.
              The overall score is informational. You do the merge.
            </Rule>
            <Rule icon={FlaskConical} title="TDD gate">
              Write the failing test before the code. <code className="font-mono">/code-review</code> blocks on red
              tests — no scoring happens until the suite is green.
            </Rule>
            <Rule icon={Layers} title="Stacked MRs">
              Build the whole stack without per-PR review, then run one batch review pass that reviews every PR in
              parallel (each in its own worktree).
            </Rule>
            <Rule icon={TicketIcon} title="Horizons & HITL">
              Tickets carry a horizon (<span className="text-zinc-300">now / next / future</span>); flag{' '}
              <code className="font-mono">hitl: true</code> when something genuinely needs a human — it surfaces in
              the HITL tab.
            </Rule>
            <Rule icon={FileText} title="Docs are live">
              Capture decisions as ADRs, ops as runbooks, findings as learnings (<code className="font-mono">/document</code>);
              rot-check with <code className="font-mono">/document-audit</code>. Keep them honest, never frozen.
            </Rule>
            <Rule icon={Radar} title="Cadence checks">
              <code className="font-mono">/check</code> runs deep repo inspections on a cadence (not per commit);
              they report, they don't auto-edit — cleanup becomes a ticket.
            </Rule>
          </div>
        </Section>

        <Section icon={Play} title="Get started">
          <ol className="list-decimal space-y-1.5 pl-5 text-[12px] leading-snug text-zinc-400 marker:text-zinc-600">
            <li>Point a session at a repo (or scaffold a fresh one from project-template).</li>
            <li>
              Run <code className="font-mono text-[var(--gt-accent-light)]">/session-start "&lt;your goal&gt;"</code>.
            </li>
            <li>
              Capture or pick a ticket, then{' '}
              <code className="font-mono text-[var(--gt-accent-light)]">/pr-creation</code> to implement it into an
              open PR.
            </li>
            <li>
              Run <code className="font-mono text-[var(--gt-accent-light)]">/code-review</code> when ready; fix
              findings until it hits the bar.
            </li>
            <li>
              Merge it yourself, then{' '}
              <code className="font-mono text-[var(--gt-accent-light)]">/merge-sync</code> and{' '}
              <code className="font-mono text-[var(--gt-accent-light)]">/session-end</code>.
            </li>
          </ol>
        </Section>
      </div>
    </div>
  )
}

const tab: Tab = {
  id: 'help',
  title: 'Help',
  icon: LifeBuoy,
  order: 0, // first registry tab (after Terminal), prominent for onboarding
  appliesTo: () => true,
  Component: HelpTab,
}
export default tab
