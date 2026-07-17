# Alert channels

How TerMinal's outbound alerts (completion / blocker / HITL pings) fan out to
multiple destinations. Edit in place as channels are added. Code:
`src/main/notify-channels.ts` (abstraction + channels) and `src/main/events.ts`
(the emit path that calls it).

## The NotifyChannel abstraction

Every high-signal activity event (see the `NOTIFY` map in `events.ts`) is mapped
to a channel-agnostic shape and dispatched to **all enabled channels**:

- `kind` — `done | blocked | question | info` (the same vocabulary the notify
  skill uses; in-app events map to `done`/`blocked`/`info` via `notifyKindFor`)
- `title`, `detail` — the human-readable message
- `refs` — join keys: `{ ticket?, pr?, runId?, hitlId?, repo? }`

A channel implements:

```ts
type NotifyChannel = {
  id: 'telegram' | 'desktop' | 'webhook'
  enabled(): boolean // reads Settings; cheap, called per alert
  send(kind, title, detail, refs): void | Promise<void>
}
```

`dispatchAlert` guarantees **per-channel failure isolation**: a channel that
throws (sync) or rejects (async) is logged to stderr and never blocks the other
channels or the emitting run. Adding a provider = one `create<X>Channel` factory
in `notify-channels.ts` + a config block in Settings — no new hardcoded branches
in the emit path.

Inbound replies (AFK remote control) remain **Telegram-only** (`telegram.ts`);
this layer is outbound alerts.

## Channels

| Channel | Enable knob | Config | Default |
| --- | --- | --- | --- |
| Telegram | `telegram.notify` | bot token + chat id (Settings → Telegram, sealed) | off |
| Desktop | `alerts.desktop.enabled` | — (Electron `Notification`) | **on** |
| Webhook | `alerts.webhook.enabled` | `alerts.webhook.url` (sealed) | off |

Settings → **Alert channels** has the toggles, the webhook URL field, and a
"Test" button per channel (`alerts:test` IPC).

## Webhook payload

The webhook channel POSTs one JSON body per alert to the configured http(s)
URL (8s timeout, `content-type: application/json`):

```json
{
  "source": "terminal",
  "kind": "done",
  "title": "Tests green",
  "detail": "suite passed",
  "refs": { "ticket": 19, "pr": 87, "runId": "…", "hitlId": "…", "repo": "TerMinal" },
  "ts": 1752700000000,
  "text": "✅ Tests green — suite passed",
  "content": "✅ Tests green — suite passed"
}
```

- **Slack** incoming webhooks render `text` — paste a
  `https://hooks.slack.com/services/…` URL and it works as-is.
- **Discord** incoming webhooks render `content` — same story.
- Custom receivers should consume the structured fields (`kind`, `refs`) and
  ignore the display strings.

Empty `refs` keys are omitted-as-`undefined`; `detail` is `""` when absent.
The URL is stored sealed (OS keychain encryption) like the other secrets in
`settings.json`, because Slack/Discord webhook URLs embed a capability token.

## Follow-ups (not in this layer yet)

- Inbound parity per channel (Slack slash-commands etc.) — Telegram-only today.
- Native Slack API / email (SMTP) channels, if the webhook path proves too thin.
- Out-of-process emitters (`bin/terminal-cron`, `bin/terminal-cli`) still ping
  Telegram directly via the creds sidecar; routing them through the fan-out
  would need the webhook URL mirrored like `telegram.local.json`.
