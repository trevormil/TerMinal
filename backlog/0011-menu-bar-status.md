---
id: 11
title: "Menu-bar fleet status: NSStatusItem + dock badge for at-desk awareness"
status: closed
priority: medium
horizon: next
hitl: false
type: ux
source: research
created: 2026-05-30
updated: 2026-05-30
prs: []
refs: []
depends_on: []
---

A persistent macOS menu-bar icon (NSStatusItem via Electron's Tray API)
that surfaces fleet state at a glance, regardless of whether TerMinal's
main window is open. The "walk past my laptop and know if anything needs
me" surface that complements Telegram (remote) and the dashboard
(deep-dive).

**Filter applied:** sessions can't render anything outside their own pane.
An always-visible OS-level surface for the whole fleet is exactly the
cross-session view the harness already owns. This is a real UI feature
the user sees and clicks, not a workflow trigger.

## Visual states

| Icon | When |
|---|---|
| 🟢 (green) | normal — no HITL, no failures, budget < 50% |
| 🟡 (yellow) | budget 50-89%, OR 1-2 HITL items, OR a schedule paused, OR a stuck session detected |
| 🔴 (red) | ≥ 1 HITL open, OR a cron failure in last 1h, OR budget ≥ 90% |
| 💲 (with $ overlay) | budget > 50% — combined with the color above |

The icon itself is a small TerMinal-branded glyph (subset of the existing
logo); the color/badge is the live signal.

Tooltip on hover:
```
TerMinal · 2 HITL · $4.20 today · 3 sessions
```

## Click menu (NSMenu)

Clicking the icon drops a context menu rebuilt from current state:

```
─────────────────────────────────────
2 HITL pending                     → 
  Scheduled run failed · docs
  Worktree setup failed · vellum
─────────────────────────────────────
$4.20 spent today                  → Observability
  └ claude $3.10 · codex $1.10
2 cron failures in last 1h         → Runs (failed filter)
3 background tasks running         → Runs (bg-task filter)
─────────────────────────────────────
⏸  Snooze all schedules for 1h
🛑 Force-stop all background tasks
🌿 12 worktrees · 1.8 GB           → Worktrees
─────────────────────────────────────
Open TerMinal
Quit
```

Each row that links to a tab uses the cross-tab nav bus
(`navigateTo('hitl' | 'observability' | etc.)`) to open the main window
and switch to that tab.

## Dock badge

Matches the HITL open-count (red badge with number, macOS convention).
Set via `app.dock.setBadge(String(count))` — clears when count is 0.

## Polling

5-second interval poll of existing IPC handlers:
- `gt.hitl.list()` — for HITL count
- `gt.harnessStatus()` — for cron failures, paused schedules, runs
- (Once #0001 lands) — observability summary for today's spend

No new backend needed; this is purely a renderer-of-existing-data layer
running in the main process.

## Implementation

Electron `Tray` API:

```ts
import { Tray, Menu, nativeImage } from 'electron'

const tray = new Tray(nativeImage.createFromPath(iconPath))
tray.setToolTip('TerMinal · loading…')

function rebuild() {
  const menu = Menu.buildFromTemplate([...])
  tray.setContextMenu(menu)
  tray.setToolTip(`TerMinal · ${tooltipParts.join(' · ')}`)
  tray.setImage(iconForState(state))
  app.dock.setBadge(hitlCount > 0 ? String(hitlCount) : '')
}

setInterval(rebuild, 5000)
rebuild()
```

Icon assets: 4 PNG variants (green/yellow/red, with and without $) at
@1x and @2x for Retina. Single-color SVG would be ideal (template image
that respects light/dark menu bar) but the $/colored-state combinations
make multi-icon simpler.

## Settings toggle

Settings → UI section:
- [x] Show menu bar status (default on)

When off: `tray?.destroy()`, no polling, no dock badge.

## Actions

The two interactive items in the menu:

**Snooze all schedules for 1h:**
- For every schedule id: `setDisabled(id, true)` via the existing
  `agents-disabled` helper
- Writes a `~/.config/TerMinal/snooze.json` with `expiresAt` — a small
  watcher reverses at expiry (or user can `/resume` early via Telegram)
- Activity event + Telegram ping confirming the snooze

**Force-stop all background tasks:**
- Confirm dialog (Electron `dialog.showMessageBox`)
- SIGTERM every pid in `bg-tasks.json` with status `running`
- Wait 5s, SIGKILL stragglers
- Worktrees retained for inspection (consistent with `/bg cancel`)

## Stage plan

**Stage 1** — Tray icon + tooltip + simple poll. Just shows state, no
menu interactivity yet. Verify the polling loop doesn't churn CPU.

**Stage 2** — Full context menu with nav-to-tab actions. Dock badge.

**Stage 3** — Snooze + force-stop actions.

**Stage 4** — Settings toggle to hide.

**Stage 5** — Once #0001 lands, add the spend rows.

## Non-goals

- No notifications from the menu bar (existing macOS Notification path
  via `fireNotification` covers that)
- No mini-widget / inline preview windows (just a dropdown menu)
- No customizable layout. Fixed sections in a fixed order.
- No Windows/Linux equivalent — TerMinal is macOS-only

## Risk

Very low. Additive UI on existing data. 5-second poll is cheap.
Settings toggle for users who don't want the menu-bar real-estate.
