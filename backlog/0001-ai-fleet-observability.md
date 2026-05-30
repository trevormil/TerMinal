---
id: 1
title: "AI fleet observability: track every claude/codex run + costs + rate limits"
status: closed
priority: high
horizon: now
hitl: false
type: feature
source: research
created: 2026-05-30
updated: 2026-05-30
prs: []
refs: []
depends_on: []
---

Build deep, local-first observability across every AI execution surface the
harness can see. Validates the harness-is-product thesis and forms the
foundation for cost guardrails, three-tier routing, and self-healing follow-ups.

No LangFuse / external SaaS. Everything stays in `~/.config/TerMinal/`.

## Sources to instrument

1. **Interactive Claude Code sessions** — `~/.claude/projects/<hash>/<sid>.jsonl`.
   We already parse these (`parseTranscriptFile` → `contextTokens`, `turns`).
   Extend with per-turn `input_tokens`, `output_tokens`,
   `cache_read_input_tokens`, `cache_creation_input_tokens`, `model`. Aggregate
   into per-session AIRun records.
2. **Interactive Codex CLI sessions** — `~/.codex/sessions/`. New parser; same
   AIRun shape. Codex emits per-turn usage in its transcript.
3. **Cron-fired agent runs** — `bin/terminal-cron`'s `claude -p` / `codex exec`
   children. Parse the usage summary line at exit (claude -p and codex exec both
   print model+tokens+cost). Already capture stdout into
   `cron-runs/<id>.log` — usage line lives at the tail.
4. **In-process agent runs** — `src/main/agents.ts runSpec`. Same parse-the-tail
   pattern; we already control the spawn and capture output.

## Storage

Separate from operational data — `cron-runs/` stays the source of truth for
status/exit/log; `ai-runs/` is the cost/tokens layer cross-linked by `runId`.

```
~/.config/TerMinal/ai-runs/<aiRunId>.json     # per-run AIRun records
~/.config/TerMinal/ai-stats/<YYYY-MM-DD>.json # daily rollups (computed)
~/.config/TerMinal/ai-pricing.json            # editable price table
```

Operational (`cron-runs/`) + cost (`ai-runs/`) are joined by the `runId` field
when both exist. Sessions show up only in `ai-runs/` (no operational equivalent).

## AIRun shape

```ts
type AIRun = {
  id: string                    // our uuid
  source: 'claude-code' | 'claude-p' | 'codex-cli' | 'codex-exec'
  startedAt: number
  endedAt?: number
  model: string                 // 'claude-opus-4-7', 'gpt-5', etc.
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costUsd: number               // computed = pricing × tokens
  repoRoot: string
  sessionId?: string            // Claude/Codex transcript id when known
  runId?: string                // cron/agent run id when known
  agentId?: string              // scheduled agent id when applicable
  durationMs?: number
  exitCode?: number
  outcome?: 'pr-opened' | 'ticket-filed' | 'merged' | 'none'  // ROI link
}
```

## Pricing table

`src/main/ai-pricing.ts` exports a map of model → `{ inputUsdPerMTok,
outputUsdPerMTok, cacheReadUsdPerMTok?, cacheWriteUsdPerMTok? }`. Updated by
hand when prices change. Pure data, no external API.

Cost = sum over (tokenType × ratePerMTok / 1e6).

Unknown model → record tokens, leave `costUsd: 0`, log a warning so we know
to update the table.

## Rate-limit headroom

Already have `/usage` IPC for Claude. Snapshot every 5 min to
`ai-stats/usage-<YYYY-MM-DD>.jsonl`. Lets the dashboard show "you burned 30%
of your 5h window in the last hour" rather than just a point-in-time gauge.

## UI surfaces (every level)

**1. New Observability tab** (order: ~4.5, between Schedules and Browser):
- Top cards: today's cost · this week · this month · runs in flight
- Stacked bar: cost by model (claude-opus, sonnet, haiku, codex-gpt-5)
  over last 7 days
- Per-agent ROI table: agent · runs · cost · outcomes (PRs/tickets/none) ·
  $/PR · success rate
- Rate-limit headroom chart (Claude /usage over time)
- Slow runs leaderboard: top 10 by `costUsd` or `durationMs` this week
- Drill-down: click any row → AIRun detail with model, tokens, log link

**2. Cockpit widget** ("Spend"):
- Active session's running cost in cents
- Today's total spend in this repo
- Rate-limit headroom for the active model

**3. Per-run rows everywhere**:
- Runs tab: add a small "model · $0.42" column
- Agents tab: avg cost in the recent-runs sparkline header
- Schedules tab: each schedule shows avg run cost

**4. Telegram**:
- `/cost` — today's spend by source (sessions / cron / in-process)
- `/cost <agent>` — that agent's cost this week
- `/cost @repo` — repo-level breakdown

## Stage plan

**Stage 1 — collection** (write paths only, no UI):
- `ai-pricing.ts` + `ai-runs.ts` (write/read AIRun records)
- Extend transcript parser to extract per-turn token deltas
- Extend `bin/terminal-cron` + `runSpec` to parse claude-p / codex-exec
  output and write AIRun records
- Snapshot `/usage` every 5 min into `ai-stats/`

**Stage 2 — Observability tab** (read-only dashboard):
- New `tabs/observability/index.tsx`
- IPCs: `observability:summary(range)`, `observability:byAgent(range)`,
  `observability:runs(range, filters)`, `observability:usageWindow`

**Stage 3 — surface elsewhere**:
- Cockpit "Spend" widget
- Cost columns on Runs / Agents / Schedules tabs
- Telegram `/cost` commands

## Outcome attribution (ROI)

When a cron / in-process run finishes, look for what it produced before
sweeping it into `none`:
- Emitted `pr-opened` activity → outcome `pr-opened`
- Emitted `ticket-filed` → `ticket-filed`
- Linked PR merges later → backfill `merged` (would need a watcher; could
  defer to a follow-up ticket)

## Non-goals (explicitly)

- No external SaaS (LangFuse, Braintrust, etc.)
- No SQLite — JSONL files + computed rollups
- No live streaming of partial token counts (parse on exit is enough)
- No prompt-content storage in AIRun (sessions already have transcripts;
  AIRun is metrics, not content)

## Follow-up tickets to file after this

- Cost guardrails (hard cap per session / per day)
- Three-tier routing by agent task class (cheap / standard / deep)
- Self-healing CI repair agent
- Outcome backfill watcher (PR merged after run finished)
