# TerMinal Remote — feature checklist

Living list for the iOS remote app. Check items off as they land; add freely.

## Done

- [x] Tailnet pairing (root cause: `NSAllowsLocalNetworking` suppressing
      `NSAllowsArbitraryLoads` blocked the tailnet CGNAT range — dropped it)
- [x] Remember paired Macs — tap to re-pair instead of retyping the address
- [x] New Session sheet: explicit Start button + keyboard dismissal
- [x] Chat renders Markdown + accepts images/screenshots
- [x] Registration model: a session opts in via `/remote-terminal`, engine-agnostic

## Done (this session, cont.)

- [x] **New Session end-to-end** — renderer subscribes to `remote:open-session`
      (was unwired); spawned agent gets a real tab + auto-submitted prompt
- [x] **Auto-submit the phone-spawned prompt** — was sitting unsubmitted in the
      TUI; `Choice.autoSubmit` sends the Enter
- [x] **`terminal-cli` absolute path in spawnPrompt** — bare name isn't on PATH
      and the repo bin may predate `remote`; inject `cliSrcPath()`
- [x] **Never-die listener** — Stop hook now BLOCK-parks (`remote check --wait`)
      until the next phone message instead of ending the turn; PID-locked against
      the repo+global double-registration; timeout 3600 in all settings.json;
      synced to global `~/.claude` and the template. Does not trust the agent to
      re-arm.

## Backlog

- [ ] **Unpair / switch-Mac button** in the app (today you can only re-pair from
      the unpaired state)
- [ ] **Global hook install on first run** — the app should install
      `remote-check.sh` + its Stop-hook registration into `~/.claude/settings.json`
      so a fresh machine gets never-die in every repo without manual setup
      (currently synced by hand for this machine).
- [ ] **Park duration** — capped at ~59 min per hook run (Claude Code hook
      timeout). After that the session sleeps; a launchd watcher (like the
      Telegram bridge) could re-wake a truly-idle session if we want > 1h.
- [ ] **APNs push** — dormant until the APNs key is created
      (`ios/scripts/setup-push.sh`)
- [ ] **Full tailnet fleet picker** — show ALL your Macs (via the Mac's
      `tailscale status`), not only ones you've paired with. Bigger: needs a
      tailnet-gated `/v1/tailnet` endpoint + a bootstrap for the first machine.
- [ ] Auto-scroll the selected repo into view in New Session (minor polish)
- [ ] Harness `spawn` only simulates a launch; real desktop tab happens in the app
