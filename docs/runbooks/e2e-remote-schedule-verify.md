---
title: E2E verify — remote schedule fires with the Mac asleep
last-verified: 2026-07-18
anchor: RB-e2e-remote-schedule
---

# E2E remote-schedule verification (ticket 0015)

Proves ADR-0002 [2] end-to-end: a host-targeted schedule fires via a systemd
`--user` timer on an always-on Linux host **while the Mac lid is closed**, and
the run is visible + inspectable from the Mac control plane (Runs tab host
badge, log fetch, failure surfacing). Also pins the critical gotcha:
`loginctl enable-linger` is what makes timers fire headless.

> `last-verified` above reflects verification of every command/field against
> the code (schedules.ts, schedule-router.ts, systemd.ts, host-provision.ts,
> bin/terminal-cron, remote.ts, remote-runs.ts, Runs/Schedules/HITL tabs).
> The physical execution result is recorded in [8] — re-bump the date when
> you run it.

Everything here is **read/verify or test-scoped**; the only durable writes are
the test schedule itself (created through the app) and the scratch repo.

## [1] Prerequisites

Check each before starting. `<host>` = the SSH target (e.g. an ssh-config
alias); `<hostId>` = the host's `id` in `settings.remoteHosts[]` (visible in
`~/.config/TerMinal/settings.json`; it is derived from the label at add time).

1. **Host registered.** Settings → Remote hosts has the host with
   `platform: linux`. Fields: label, sshTarget, default cwd (optional).
2. **Non-interactive SSH works** (all app SSH uses `BatchMode=yes`):
   ```bash
   ssh -o BatchMode=yes <host> true && echo SSH-OK
   ```
3. **Host provisioned** — bun, linger, runner, cli installed
   (`src/main/host-provision.ts`). There is **no Settings button** for this;
   it was done for `tm` during PRs #46–51. Verify readiness (same probe the
   `hosts:provision` IPC runs):
   ```bash
   ssh <host> 'bash -lc "
     export PATH=\"$HOME/.bun/bin:$PATH\"
     echo BUN=$(bun --version 2>/dev/null)
     echo LINGER=$(loginctl show-user \"$(whoami)\" -p Linger --value)
     [ -x $HOME/.config/TerMinal/bin/terminal-cron ] && echo RUNNER=ok || echo RUNNER=missing
     [ -x $HOME/.config/TerMinal/bin/terminal-cli ] && echo CLI=ok || echo CLI=missing
     command -v node && command -v script && command -v git
   "'
   ```
   Expect `LINGER=yes`, `RUNNER=ok`, and paths for `node`, `script`, `git`.
   To (re)provision: run `await window.gt.provisionHost('<hostId>')` from the
   app's devtools console (⌥⌘I), or follow `buildProvisionScript()` by hand.
4. **`node` on the host login PATH.** The Mac read-back (runs list, log
   fetch, remote HITL) executes `node -e <script>` over SSH
   (`src/main/remote.ts` `remoteJson`) — bun alone is NOT enough. Covered by
   the probe above.
5. **git identity on the host** (the test action is a commit):
   ```bash
   ssh <host> 'git config --global user.name; git config --global user.email'
   ```
   Set both if empty, or the run will fail with "Author identity unknown".
6. **Engine auth on host — only for the optional LLM variant [3c].** The
   recommended script-first schedule never invokes an engine. The readiness
   probe only checks the binary exists (`command -v codex`), NOT that it is
   logged in; for the LLM variant, verify by hand:
   `ssh -t <host> 'bash -lc "codex exec --help >/dev/null && echo ok"'` and do
   one manual `codex exec 'say hi'` on the host if unsure.
7. **(Optional) Telegram pings from the host.** The cron runner reads
   `~/.config/TerMinal/telegram.local.json` on the HOST. Nothing syncs it
   there — copy it manually if you want failure pings during this test:
   ```bash
   scp ~/.config/TerMinal/telegram.local.json <host>:.config/TerMinal/ && ssh <host> chmod 600 .config/TerMinal/telegram.local.json
   ```

## [2] Scratch repo + test agent

The schedule needs a repo with an `origin` remote (schedule save runs
`ensureHostRepo`, which clones origin onto the host at `~/repos/<name>` —
no origin → save fails with "local repo has no origin remote").

1. Create a scratch repo (any forge you have auth for) and clone it on the
   Mac, e.g. `~/terminal-e2e-scratch`.
2. Commit a **script agent** — `.agents/e2e-verify.sh` (script agents are
   discovered by filename, id must match `[a-z0-9][a-z0-9-]*`; the runner
   execs the script INSTEAD of building an engine command, so this run is
   deterministic and costs $0):
   ```bash
   #!/usr/bin/env bash
   # E2E test agent (ticket 0015): trivial-but-real action — an empty commit
   # in the isolated run worktree. E2E_FAIL=1 (per-schedule env) forces a failure.
   set -euo pipefail
   echo "e2e-verify: host=$(hostname) run=${TERMINAL_RUN_ID} branch=${TERMINAL_BRANCH}"
   if [ "${E2E_FAIL:-0}" = "1" ]; then
     echo "e2e-verify: forced failure (E2E_FAIL=1)"
     exit 1
   fi
   git -C "${TERMINAL_WORKTREE}" commit --allow-empty -m "chore(e2e): scheduled no-op commit $(date -u +%FT%TZ)"
   git -C "${TERMINAL_WORKTREE}" log -1 --oneline
   echo "e2e-verify: done"
   ```
   `chmod +x`, commit, push. (`TERMINAL_RUN_ID`, `TERMINAL_BRANCH`,
   `TERMINAL_WORKTREE` etc. are injected by `bin/terminal-cron`.)
   Optionally append `git -C "${TERMINAL_WORKTREE}" push -u origin "${TERMINAL_BRANCH}"`
   for an off-box-visible artifact — that additionally requires push
   credentials on the host; the commit alone is sufficient proof (visible in
   the run log and in the host worktree).
3. **Gotcha — the host clone never auto-pulls.** `ensureHostRepo` clones
   once; the runner's worktree is created off the clone's local default
   branch. If you change `.agents/e2e-verify.sh` after the host clone
   exists: `ssh <host> 'git -C ~/repos/terminal-e2e-scratch pull'`.

## [3] Create the host-targeted test schedule

Do this in the app, in a session whose cwd is the scratch repo (schedules are
created against the current session's repo).

**[3a] UI path** — Schedules tab → new schedule → **Form** mode:

| Field | Value | Notes |
|---|---|---|
| Run | `e2e-verify` | the script agent from [2] |
| via | codex (default) | ignored at run time — script-first wins |
| on | `<host label> (systemd)` | selector shows a reachability dot (PR #55); ● = reachable |
| runtime | `bare` | the ADR-0002 v1 default |
| cadence | cron: `*/10 * * * *` | fires at :00,:10,… — frequent enough to observe |
| retries | `0` | keeps the later failure test fast (default is 2 retries with 30s→2m backoff) |
| backoff / timeout | blank | runner defaults (30m timeout) |
| Env vars | *(leave empty for now)* | `E2E_FAIL=1` comes later, in [6] |

**[3b] What save does** (`schedules:add` → `routeSyncSchedule`): clones the
repo to `~/repos/terminal-e2e-scratch` on the host if absent; stores the
schedule with the HOST-relative `repoRoot`; mirrors the record into the
host's `~/.config/TerMinal/schedules.json`; installs + enables
`terminal-cron-<id>.timer`/`.service` under `~/.config/systemd/user/` on the
host. Any error surfaces in the form — a silent success with no timer is a
bug.

The resulting record in the Mac `~/.config/TerMinal/schedules.json` (and
mirrored on the host) looks like:

```json
{
  "id": "<generated-uuid>",
  "repoRoot": "~/repos/terminal-e2e-scratch",
  "repoLabel": "terminal-e2e-scratch",
  "agentId": "e2e-verify",
  "agentTitle": "e2e-verify",
  "engine": "codex",
  "prompt": "Script-based agent · body in <repo>/.agents/e2e-verify.sh",
  "spec": { "kind": "cron", "expr": "*/10 * * * *" },
  "enabled": true,
  "host": "<hostId>",
  "runtime": "bare",
  "retry": { "maxRetries": 0, "backoffSec": 30 },
  "createdAt": 0,
  "lastStatus": "never"
}
```

Verify the installed unit on the host (the `XDG_RUNTIME_DIR` export is what
makes `systemctl --user` work over non-login SSH — same trick the app uses):

```bash
ssh <host> 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user list-timers | grep terminal-cron'
ssh <host> 'cat ~/.config/systemd/user/terminal-cron-*.timer'
```

Expected timer body: one `OnCalendar=*-*-* *:MM:00` line per expanded minute
(00,10,…,50), `Persistent=true`, `WantedBy=timers.target`. The service is
`Type=oneshot`, `ExecStart=%h/.bun/bin/bun %h/.config/TerMinal/bin/terminal-cron run <id>`.

**Timezone gotcha:** `OnCalendar` is evaluated in the HOST's local timezone;
there is no TZ conversion anywhere in the chain. If the host runs UTC and
the Mac doesn't, wall-clock expectations differ for hour-specific specs
(`*/10 * * * *` is TZ-immune — one reason it's the suggested spec). Check:
`ssh <host> timedatectl | grep 'Time zone'`.

**[3c] Optional LLM variant.** To also prove engine auth end-to-end, repeat
with a normal (non-script) agent whose prompt does a trivial action, engine
`codex` — then prerequisite [1].6 is load-bearing. Do this only after the
script-first pass is green, so mechanics failures and auth failures don't
alias.

## [4] Lid-close verification (the headline test)

1. Note the current time and the next two expected fire minutes.
2. Optionally watch one fire while awake first. The Schedules tab's "run
   now" button routes a host schedule to its owning host (ticket 0043 —
   `routeRunNow` in `schedule-router.ts`; it used to fall through to a local
   `terminal-cron` run whose host-side repoRoot doesn't exist on the Mac). An
   unreachable host surfaces as a "run now failed · …" flash, not a silent
   local run. Manual fallback if the app path itself is in question:
   ```bash
   ssh <host> 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user start terminal-cron-<id>.service'
   ```
   Confirm a run row appears in the Runs tab with the host chip.
3. **Close the Mac lid.** Leave it closed across at least one scheduled
   fire (e.g. 25 min covers two).
4. Reopen. In the Runs tab press the refresh button (circular-arrows, top
   right of the list) — remote runs are fetched on tab mount and on manual
   refresh; the 2s auto-poll only re-fetches remote hosts while a remote run
   is showing `running`, so after a wake a manual refresh is the reliable
   trigger.
5. **Expected:**
   - A `cron`-source run row per fire, badged with the host label
     (`hostId`/`hostLabel` stamped by the `runs:remote-all` fan-out), status
     `done`, `startedAt` within ~1 min of the scheduled minute (systemd
     default accuracy) — while the Mac was asleep.
   - Clicking the run loads the full log over SSH (`runs:log` routes to the
     owning host): you should see the `e2e-verify:` echo lines and the no-op
     commit hash.
   - Host filter chips appear next to the source filter; filtering by the
     host shows only its runs.
   - On the host: `ssh <host> 'ls ~/.config/TerMinal/cron-runs/ | tail'`
     shows the `<runId>.json` + `.log` pair;
     `ssh <host> 'git -C ~/repos/terminal-e2e-scratch worktree list'` shows
     the run worktree with a `cron/e2e-verify-*` branch.

## [5] Linger negative test (pins the gotcha)

Linger is what keeps the systemd user manager — and therefore `--user`
timers — alive with no login session. ADR-0002 [3] calls this the headless
gotcha; this test proves it.

1. Turn linger OFF, then fully log out (the manager keeps running while any
   session exists, so the `exit` matters):
   ```bash
   ssh <host> 'loginctl disable-linger $(whoami)'
   ssh <host> 'loginctl show-user $(whoami) -p Linger --value'   # → no
   # ensure no other sessions remain (tmux/mosh/other terminals count):
   ssh <host> 'loginctl list-sessions'
   ```
2. With no sessions open, wait past at least one scheduled fire (≥ 10 min
   for `*/10`). Do not SSH in during the window — an SSH login restarts the
   user manager and defeats the test.
3. SSH back in and inspect timestamps:
   ```bash
   ssh <host> 'ls -lt ~/.config/TerMinal/cron-runs/ | head'
   ```
   **Expected:** NO run record with `startedAt` inside the lidless window —
   the timer missed. **Also expected:** because the units set
   `Persistent=true`, the missed run fires as a catch-up almost immediately
   when your login starts the user manager — so you will likely see a run
   whose `startedAt` is your login time, not the scheduled minute. That
   late-stamped run is the proof of the miss, not a refutation.
4. Re-enable and confirm headless firing resumes at the right wall-clock
   minute with no session open:
   ```bash
   ssh <host> 'loginctl enable-linger $(whoami)'
   ssh <host> 'loginctl show-user $(whoami) -p Linger --value'   # → yes
   # log out, wait one cadence, then check cron-runs timestamps again
   ```

## [6] Forced-failure test (surfacing per PRs #55/#57)

There is no schedule-edit UI, so: **delete the test schedule** (trash icon in
the Schedules tab — this also removes the host unit + record) and **recreate
it identically but with env var `E2E_FAIL=1`** (Env vars disclosure in the
form). Keep retries `0` so the failure finalizes on the first attempt; with
defaults it retries twice (30s, then 2m backoff) before failing.

Let one fire happen (lid open or closed), then check:

- **Runs tab (Mac):** the run row shows status `failed` (red badge) with the
  host chip; the log (fetched over SSH) ends with the forced-failure echo and
  a non-zero exit. The failed count in the header increments.
- **Inbox / HITL (Mac):** an open item "Scheduled run failed · e2e-verify"
  appears with a host badge — remote HITL fans out on Inbox reload (PR #57).
  Resolving it from the Mac routes back to the owning host.
- **On the host:** `cron-runs/<runId>.json` has `status: "failed"`,
  `exitCode: 1`; a best-effort backlog ticket was filed in the CLONE at
  `~/repos/terminal-e2e-scratch/backlog/0001-cron-run-failed-….md`
  (uncommitted — the scratch repo has no `.TerMinal/` layout, so the runner
  falls back to a root `backlog/` dir).
- **Telegram:** a ⛔ HITL ping ONLY if you did prerequisite [1].7 — the
  sidecar is not synced to hosts.
- **Unreachable-host degradation (bonus, PR #55):** with the host offline
  (or tailscale down), the Runs tab shows a per-host "didn't answer" error
  strip instead of silently dropping runs, and the Schedules form's host
  selector shows ○ + a classified hint (timeout/auth/dns/refused).

**Circuit-breaker warning:** 3 consecutive failures of one schedule trip the
breaker ON THE HOST (`~/.config/TerMinal/agents/disabled.json` there) and
auto-disable it. Don't let the failure schedule fire 3+ times; if it trips,
clear the id from that file on the host — the Mac Schedules tab's pause list
reads only the LOCAL disabled.json.

## [7] Cleanup

1. Delete the failure schedule in the Schedules tab (removes the host timer +
   host record; verify: the `list-timers` command from [3] shows nothing).
2. Host: remove run worktrees/branches if you care —
   `ssh <host> 'git -C ~/repos/terminal-e2e-scratch worktree list'`, then
   `git worktree remove <path>` + `git branch -D cron/e2e-verify-*`. Run
   records under `cron-runs/` are never auto-deleted; prune by hand or leave.
3. Delete `~/repos/terminal-e2e-scratch` on the host and the scratch repo
   itself if fully done.

## [8] Results — executed 2026-07-17 → 2026-07-18

Recorded from the TM host's run records and the Mac control plane after the
verification window; the scaffold (schedule + systemd timer) was deprovisioned
on 2026-07-18 once the evidence below was captured. Closes ticket 0015's
acceptance ("a documented, reproducible run").

| Item | Expected | Observed |
|---|---|---|
| Date / host (id + label) | — | 2026-07-17 22:44 → 2026-07-18 10:10 EDT, host `TM` (Ubuntu workstation) |
| Schedule id / spec | `*/10 * * * *` | `3151b43c…` on repo `terminal-e2e-scratch`, bare runtime, engine codex |
| Fire with lid closed | run at scheduled minute ±1 min | 71 runs at 10-min cadence across 13 distinct hours, continuous overnight (Mac asleep); no missed windows in the record |
| Run visible in Runs tab w/ host badge | yes, after manual refresh | yes — Runs tab lists all runs with `TM` host chip |
| Log fetch from Mac | full script output over SSH | yes — full stdout (branch, no-op commit sha, `e2e-verify: done`) renders in run detail |
| Linger OFF → fire missed | no record in window | **not exercised** — toggle experiment skipped; `Linger=yes` confirmed as the operative config via `loginctl` |
| Persistent catch-up at login | late-stamped run at login time | **not exercised** (depends on the linger-off test) |
| Linger ON → headless fire resumes | yes | headless firing under `Linger=yes` demonstrated by the full run history |
| Forced failure → Runs tab | red `failed` + host chip | 1 failed run (exit 126, first firing before the script was executable) shown as `failed` in Runs |
| Forced failure → Inbox HITL w/ host badge | yes | e2e-related HITL items present in the Inbox record |
| Host backlog ticket filed | `backlog/0001-…` in host clone | yes — `backlog/` present in the host's `terminal-e2e-scratch` clone |
| Telegram ping (if sidecar copied) | ⛔ HITL message | **not exercised** (sidecar not copied to the scratch repo) |
| Gotchas / notes | — | exit 126 on first fire = script shipped without the executable bit — chmod in provisioning; teardown [7] pending: delete `~/repos/terminal-e2e-scratch` on TM + the scratch GitHub repo |
