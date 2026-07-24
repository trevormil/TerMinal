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
- [x] **Never-die is truly unbounded** — on the Stop-hook timeout the hook now
      re-parks via a heartbeat block instead of dying. 59 min is a heartbeat, not
      a death. (Claude Code hook timeout has no documented max; default 600s.)
- [x] **Unpair / switch-Mac** — already shipped: the ⋯ menu unpairs and returns
      to the pairing screen, which lists remembered Macs for a one-tap switch.

- [x] **Per-repo workspaces** — Workspaces tab → repo → Sessions/Tickets/PRs/
      Runs/Schedules, plus a global Inbox tab
- [x] **Terminate / delete sessions** from the phone (long-press; Clear finished)
- [x] **Chat UX** — real paragraphs/headings/bullets (Markdown's soft-break rule
      was folding every newline into a space) and long-press "Copy message"
      (selection only ever works inside one Text, so it could never copy a whole
      multi-block message)
- [x] **Drill-downs, full content** — ticket body + acceptance, PR
      description/review/findings/CI/diff, run logs (sanitized, tail-first),
      schedule prompts. Logs and diffs are capped and flagged `truncated`.
- [x] **Stop hook no longer hangs ordinary sessions** — strict agent-session
      match + only phone-spawned sessions park

## Backlog

- [ ] **Global hook install** — DEFERRED as auto-install: the app deliberately
      avoids writing to `~/.claude` (see the OpenRouter "no global dotfiles"
      note), so silently editing `~/.claude/settings.json` on startup is out.
      Covered instead by: the repo/template ships the Stop hook, and
      `docs/runbooks/remote-never-die-hook.md` documents the one-line global
      registration for full cross-repo coverage.
- [ ] **APNs push** — dormant until the APNs key is created
      (`ios/scripts/setup-push.sh`)
- [ ] **Full tailnet fleet picker** — show ALL your Macs via the *currently
      paired* Mac's `tailscale status` (a "Switch to…" list in the ⋯ menu). This
      sidesteps the bootstrap problem since you're already paired with one Mac.
      Needs an authenticated `/v1/tailnet` endpoint + iOS UI.
- [ ] Harness `spawn` only simulates a launch; real desktop tab happens in the app
- [ ] Heartbeat turns accumulate in the spawned terminal over long idle (~1/hr);
      harmless but could be quieted with app-side pty re-injection later
