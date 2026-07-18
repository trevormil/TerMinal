# Agent Process

This is the canonical workflow contract for TerMinal-backed agents in this
repo. Skill files should reference this page instead of restating the full
process.

## Architecture

```text
User / Factory
  |
  v
Ticket intake
  - .TerMinal/backlog/NNNN-slug.md
  - exactly one owner: agent_id + agent_scope + agent_kind
  |
  v
Agent selection
  - list_agents / .claude/bin/list-agents
  - split multi-agent work into linked tickets
  |
  v
Knowledge phase
  - read ticket, refs, relevant instructions, smallest source surface
  - request_agent_artifact for cross-domain questions
  |
  v
Implementation phase
  - branch/worktree
  - TDD-first changes
  - local sanity checks
  |
  v
Follow-up phase
  - file scoped follow-up tickets for deferred work
  - assign exactly one owner to each
  |
  v
PR/MR phase
  - push feature branch
  - open PR/MR
  - link PR/MR into ticket
  |
  v
Review and merge phase
  - code-review agent writes artifact
  - human merges
  - /merge-sync closes tickets
```

## Core Invariants

| Rule | Why |
|---|---|
| One ticket has exactly one owner agent. | Keeps responsibility clear and makes one-click implement deterministic. |
| Multi-agent work becomes multiple linked tickets. | Prevents one agent from silently owning phases outside its domain. |
| Knowledge gathering happens before edits. | Reduces wrong first attempts and keeps implementation scoped. |
| Delegated answers become artifacts, not chat bloat. | Parent agents keep only a summary and path. |
| Follow-up tickets are filed before handoff. | Deferred work stays actionable and owner-scoped. |
| Main/master merge is human-only unless the repo explicitly opts out. | Keeps protected-branch policy consistent. |

## Agent Inventory

Use MCP when available:

```text
list_agents({repo})
```

Fallback:

```bash
.claude/bin/list-agents
```

The result is a compact list of assignable agents:

| Field | Meaning |
|---|---|
| `id` | Agent identifier, such as `factory`, `security-sweep`, or a custom id. |
| `scope` | `repo` for repo-local agents/scripts, `global` for TerMinal global agents. |
| `kind` | `classic` for normal agents/scripts, `persistent` for memory-backed agents. |

TerMinal normalizes classic and persistent agents into one definition shape for
selection, tickets, one-click implement, and evaluation:

```json
{
  "ref": { "id": "security-sweep", "scope": "global", "kind": "classic" },
  "runtime": {
    "engine": "claude",
    "modelPolicy": {
      "default": "claude-sonnet-4",
      "cheap": "claude-haiku-4",
      "deep": "claude-opus-4",
      "judge": "gpt-5-mini",
      "allowOverride": true
    },
    "mode": "prompt"
  },
  "instructions": {
    "knowledgePolicy": "standard",
    "outputContract": "Short description of the expected artifact."
  },
  "quality": {
    "acceptanceCriteria": ["Concrete pass/fail criteria."],
    "requiredArtifacts": ["report.md"],
    "deterministicChecks": [
      { "id": "tests", "title": "Tests pass", "command": "bun test", "required": true }
    ],
    "judge": {
      "enabled": false,
      "mode": "deterministic",
      "rubric": ["Output matches the agent purpose."]
    }
  }
}
```

Every agent should declare the cheapest model that can do routine work, the
deep model for hard reasoning, and the judge model when LLM-as-judge is enabled.
Deterministic checks are preferred over LLM judging when the result can be
verified with a command.

## Ticket Ownership

Every ticket frontmatter includes:

```yaml
agent_id: factory
agent_scope: global
agent_kind: classic
```

If the owner is missing, assign it before implementation with
`update_ticket_agent` or by updating the ticket frontmatter. If implementation
reveals more owners are needed, file follow-up tickets and link them with
`depends_on`.

When an agent starts implementation, the ticket should also record the pickup
run:

```yaml
agent_run_id: <TERMINAL_RUN_ID or spawned run id>
agent_run_source: agent
agent_session_id: <launcher session id, when available>
agent_run_started_at: <ISO timestamp>
agent_run_status: running
```

Use `update_ticket_run` for this write when MCP is available. TerMinal writes
these fields automatically for one-click process-mode ticket implementation.
The Tickets tab uses them for one-click run viewing and rerun/resume.

## Knowledge Phase

Before editing code, the assigned agent reads:

- the ticket body and acceptance criteria
- referenced docs, ADRs, runbooks, and prior artifacts
- relevant root/nested instructions
- the smallest source surface needed to understand the change

For cross-domain questions, delegate:

```text
request_agent_artifact({
  repo,
  title,
  prompt,
  agentId,
  agentScope,
  agentKind
})
```

Fallback:

```bash
.claude/bin/request-agent-artifact --agent security-sweep --title "Auth risk check" -- "Review ticket #123 for auth risks and cite paths."
```

The delegate writes `.TerMinal/agent-requests/<run>/report.md`. The caller keeps
the path and a short summary, not the full transcript.

## Staged Implementation Plans

For complex full-stack, cross-service, migration, or high-risk tickets, write a
small staged plan before editing. Put it in the ticket body or live session doc;
do not introduce a separate DAG runner for normal work.

Each stage should include:

- **Name** — the work slice, such as migration, API, frontend, tests, config, or
  permissions.
- **Depends on** — prior stages or `none`.
- **Verify** — the deterministic check, test, smoke command, or review artifact
  that proves the stage is ready.
- **Human gate** — only when a human decision or approval is truly required,
  such as a destructive migration or ambiguous product choice.

Example:

```markdown
## Implementation Plan

1. Migration
   - Depends on: none
   - Verify: migration/schema test
   - Human gate: yes, if destructive

2. API
   - Depends on: Migration
   - Verify: route/service tests

3. Frontend
   - Depends on: API contract
   - Verify: component or integration test

4. Config / permissions
   - Depends on: API
   - Verify: permission and feature-flag test
```

## Quality Phase

Before handoff, the assigned agent evaluates its output against its definition:

1. Verify all acceptance criteria are met or explicitly call out the miss.
2. Produce required artifacts such as reports, screenshots, or ticket links.
3. Run deterministic checks listed by the agent when they apply to the changed
   surface.
4. Use an LLM judge only when the agent definition enables one and the result
   cannot be checked deterministically.

TerMinal records the completion result on the run itself. For in-process agent
runs this includes:

```yaml
evaluation:
  status: pass | fail | incomplete
  summary: string
  checks:
    - id: string
      title: string
      command: string
      status: pass | fail | skipped
      required: true | false
  judge:
    status: not-run
```

The deterministic completion pass runs configured shell checks. LLM-as-judge is
represented in the schema but remains explicit opt-in work; it is not invoked
implicitly at process exit.

## Implementation Phase

The assigned agent:

1. Sets the ticket `in-progress`.
2. Creates a feature branch or worktree.
3. Writes the failing test first when adding behavior.
4. Implements the smallest scoped change.
5. Runs the relevant local checks.
6. Reviews the diff for unrelated changes or leaked files.

## Follow-Up Phase

Before opening or handing off a PR/MR, the agent checks for deferred work:

- missing tests
- docs/runbook gaps
- bugs discovered outside scope
- refactors not needed for this ticket
- phases better owned by another agent

Each follow-up gets a ticket with one owner agent. If the follow-up depends on
this ticket or PR, link it with `depends_on`.

## Orchestration Modes

| Mode | Role |
|---|---|
| `/pr-creation` | Implements one owner-compatible ticket set into one PR/MR. |
| `/stacked-mr` | Builds several PRs in a stack, then batch-reviews them. |
| `/factory` | Loops `/merge-sync` + `/stacked-mr`, optionally refilling work. |
| `/check` | Runs scheduled/cadence agents that may report, file tickets, or open PRs. |
| `code-review` agent | Runs review/test artifact generation, and may file owner-scoped follow-up tickets. `/code-review` is a compatibility command that launches this reviewer. |

## Handoff

A complete handoff includes:

- ticket id/title
- owner agent
- branch and PR/MR URL if created
- checks run
- delegated artifact paths used
- follow-up ticket ids or `none`
- blockers/HITL ids if any
