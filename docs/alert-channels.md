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
  id: 'telegram' | 'desktop' | 'webhook' | 'push'
  label?: string // for logs, when one id has several instances
  wants?(category): boolean // per-INSTANCE routing; overrides the matrix row
  enabled(): boolean // reads Settings; cheap, called per alert
  send(kind, title, detail, refs): void | Promise<void>
}
```

Routing is normally the notification matrix (`src/shared/notifications.ts`):
each channel id opts into event *categories*. Webhooks are the exception — there
can be several, sharing one id, each wanting different traffic — so a webhook
channel carries its own `wants`, and the matrix's `webhook` row (shown in
Settings as **Webhook default**) is the fallback for destinations that haven't
customized anything.

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
| Webhook | per-entry `enabled` | `alerts.webhooks[]` — `{ id, name, url (sealed), enabled, categories? }` | none configured |
| Phone | `bridge.enabled` + a registered device | APNs key (see the bridge docs) | off |

Settings → **Alert channels** has the toggles, the webhook list (add / name /
URL / delete, per-destination category chips, and a "Test" button per
destination — `alerts:test` takes a `webhookId`).

### Several webhooks

`alerts.webhooks` is a list, so a Slack channel, a Discord channel and your own
endpoint can each take different traffic. `createWebhookChannels` builds one
`NotifyChannel` per entry, and `events.ts` rebuilds that list on every dispatch
so adding or editing a destination takes effect without a restart.

Each entry's `categories` overrides the matrix row **for that destination
only**; omit it to follow the row. The emit gate (`anyChannelWants`) is passed
every entry's overrides, so a destination that opts into a category no other
channel wants still gets the event.

**Migration.** The pre-list shape (`alerts.webhook = { enabled, url }`) is read
on first load and becomes a single `id: 'default'` entry, keeping its URL even
when disabled. Nothing to do by hand.

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
Every URL is stored sealed (OS keychain encryption) like the other secrets in
`settings.json`, because Slack/Discord webhook URLs embed a capability token.
The sealed paths are wildcards over the list (`alerts.webhooks.*.url`) — see
`src/main/secret-paths.ts`, the one list that both sealing and renderer-masking
walk. The renderer only ever receives a mask, which is why a settings patch
identifies an entry by `id` and main restores the saved URL for any entry whose
`url` is absent (an empty string is an explicit Clear).

## Follow-ups (not in this layer yet)

- Inbound parity per channel (Slack slash-commands etc.) — Telegram-only today.
- Native Slack API / email (SMTP) channels, if the webhook path proves too thin.
- Out-of-process emitters (`bin/terminal-cron`, `bin/terminal-cli`) still ping
  Telegram directly via the creds sidecar; routing them through the fan-out
  would need the webhook URLs mirrored like `telegram.local.json`.
- Per-destination payload shaping (Slack Block Kit, custom templates) — every
  webhook gets the same JSON body today.
