# 19. Slack as an inbox destination — bot token, per-category channels, hitl.json stays the store

Date: 2026-08-07

Status: accepted

## Context

The Inbox (global HITL queue) is the app's human entrypoint, but it only nags
through the desktop badge, macOS notifications, and Telegram. Slack is where a
lot of triage already happens, and the Inbox's free-form `/`-nested categories
(`Monitoring/Certs`) map naturally onto channels. The feature request: mirror
inbox posts to Slack, one channel per category/subcategory, with a preference
for Inbox-only, Inbox + Slack, or Slack-only.

Two integration shapes were possible: incoming webhooks (already half-supported
via `alerts.webhooks`) or a Slack app bot token.

## Decision

1. **Bot token (`xoxb-`), not an incoming webhook.** A webhook is pinned to one
   channel at creation time; the whole point here is routing by category at
   post time, including creating channels that don't exist yet
   (`conversations.create`). Scopes: `chat:write`, `channels:manage` +
   `channels:join` (auto-create), `reactions:write`.
2. **Channel mapping is derived, never registered** — the same rule categories
   themselves follow (ADR-implicit in ticket 120). `shared/slack.ts` slugifies
   the category path (`Monitoring/Certs` → `#<prefix>-monitoring-certs`);
   Uncategorized and unroutable posts land in the configured default channel.
   One pure function shared by main, the renderer (sidebar `#channel` hints),
   and the bin filers.
3. **`inbox.destination: 'inbox' | 'both' | 'slack'`** (default `'inbox'`).
   In **`slack`** mode every item still persists to `hitl.json` — dedup,
   recurrence, resolve state, the iOS app, and Telegram resolve buttons all
   read it. The mode only moves the *nag*: desktop badge, macOS and Telegram
   pings go quiet, and the drawer stays browsable. Dropping the durable store
   would have made Slack a single point of failure for blockers.
4. **Full lifecycle, one-way.** Filings post (Block Kit), dedup recurrences
   thread under the original message (`slackTs`/`slackChannel` stamped onto the
   item after the async post), resolves add a `white_check_mark` reaction.
   Resolving FROM Slack needs a Socket Mode app — deliberately out of scope.
5. **Out-of-process filers get a 0600 sidecar** (`slack.local.json`), the exact
   pattern `telegram.local.json` established: bin scripts can't decrypt the
   sealed token, so the app mirrors it (plus channel config + destination)
   whenever Slack is active, and deletes it when it isn't.

## Consequences

- A new category self-names its channel; nothing to configure per category.
- `terminal-cli` / `terminal-cron` / `terminal-mcp-server` inline the slug +
  post logic (standalone scripts, no imports) — keep in sync with
  `src/shared/slack.ts` + `src/main/slack-mirror.ts`, as flagged in each copy.
- Slack delivery is best-effort by contract: a failed post can never block or
  fail a filing, and a lost `slackTs` stamp only costs threading.
- Bulk "mark all read" does not fan out reactions to Slack (only the explicit
  resolve gesture does) — a 40-item sweep should not fire 40 API calls.
