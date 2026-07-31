# scripts — the unified executable (design proposal, supersedes pipelines.md)

## The pivot

Today TerMinal has three abstractions for "run something":

- **Agent**: a `prompt` string wrapped at run-time as `claude -p $prompt` or
  `codex exec ... $prompt`.
- **Schedule**: launchd wrapping an agent on a cadence.
- **Pipeline** (proposed): a YAML graph of script + llm steps with conditionals.

The pivot: collapse all three into **one** concept — an **executable file**
(typically bash) that the runner just runs. The script chooses internally
whether to use `claude -p`, `codex exec`, deterministic shell commands, or
some mix. The "pipeline" is just a script with a few `if` blocks.

This eliminates the agents-vs-pipelines distinction, gives operators the full
power of bash + their existing toolchain, lets schedules avoid paying for an
LLM when a precheck script can answer "all green" cheaply, and stays trivially
inspectable — you can `cat` an agent definition and read what it does.

## File layout

```
.agents/<id>.sh                              # per-repo executable
.agents/<id>.json                            # per-repo metadata (sidecar)
~/.config/TerMinal/scripts/<id>.sh           # global
~/.config/TerMinal/scripts/<id>.json         # global metadata
```

Sidecar metadata stays as JSON for trivial parsing in main; the script body
is whatever bash needs to be. Frontmatter inside the script is allowed but
not required — the sidecar JSON is authoritative.

### Metadata sidecar

```json
{
  "id": "health-then-fix",
  "title": "Health check + LLM fix",
  "description": "Cheap precheck, escalate to claude only on failure.",
  "icon": "Activity",
  "opensPr": true,
  "inPlace": false,
  "engineHint": "claude",
  "modelHint": "sonnet"
}
```

`engineHint` + `modelHint` are *suggestions* the script body honors via
`$TERMINAL_ENGINE` / `$TERMINAL_MODEL` env vars; the schedule or one-off
launch can override them.

## The script body

A minimal "old-style" agent translates 1:1:

```bash
#!/usr/bin/env bash
set -euo pipefail
exec claude -p 'Act as the documentation agent ...' --dangerously-skip-permissions --permission-mode auto
```

A pipeline-style script with a conditional escalation:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Precheck — cheap, no LLM
if bunx tsc --noEmit -p tsconfig.json \
   && bun test --bail \
   && curl -fsS "${HEALTH_URL:-http://localhost:3000/healthz}" > /dev/null; then
  echo "Healthy — no LLM run needed."
  exit 0
fi

# Failed precheck — escalate
claude -p "The health check failed. Diagnose and either apply a safe fix and open a PR, or file a HITL with the failure context." \
  --dangerously-skip-permissions \
  --permission-mode auto \
  --model "${TERMINAL_MODEL:-sonnet}"
```

## Runner environment

The runner exports the following env vars before exec'ing the script:

```
TERMINAL_REPO        repo root (absolute)
TERMINAL_RUN_ID      run uuid
TERMINAL_AGENT_ID    id of this agent (used as the state key — see below)
TERMINAL_BRANCH      worktree branch (or "main" if inPlace)
TERMINAL_WORKTREE    worktree path (== TERMINAL_REPO if inPlace)
TERMINAL_ENGINE      hint from sidecar / schedule override
TERMINAL_MODEL       hint from sidecar / schedule override
TERMINAL_TICKET      ticket id, when invoked from a ticket context
TERMINAL_PR          PR/MR number, when invoked from a PR-tab agent
```

PATH is augmented to include the TerMinal CLI helpers:

```
~/.config/TerMinal/bin/terminal-cli ticket "<title>" "<body>"
~/.config/TerMinal/bin/terminal-cli hitl "<title>" "<action>"
~/.config/TerMinal/bin/terminal-cli activity "<kind>" "<title>" "<detail>"
~/.config/TerMinal/bin/terminal-cli notify "<message>"
~/.config/TerMinal/bin/terminal-cli state {get-sha,mark-main,get,set,set-sha}
```

So a script can file a HITL with `terminal-cli hitl "Auth keys missing" "rotate in 1password"` — no need to hardcode the JSON file location.

## Per-(repo, agent) state

A standing problem for any agent that runs on a cadence: **what's the cheapest way to know what changed since last time?** The answer is the harness-owned state sidecar at:

```
~/.config/TerMinal/agent-state/<repo-basename>/<TERMINAL_AGENT_ID>.json
```

The state file lives **outside the repo** so cron-fired runs never dirty the working tree. The harness owns three canonical fields; scripts can set arbitrary string keys beyond that.

| Field           | Set by                       | Meaning                                                         |
|-----------------|------------------------------|-----------------------------------------------------------------|
| `lastScannedSha`| `state set-sha` / `mark-main`| Tip of **main/master** at the end of the previous scan          |
| `lastScannedRef`| `state mark-main`            | Which ref produced that sha (e.g. `origin/main`)                |
| `lastRunAt`     | any write                    | ms epoch of the most recent state write                         |
| `lastRunId`     | any write (if `TERMINAL_RUN_ID` set) | run id that produced the last write                     |

### Canonical incremental-scan pattern

Most cadence agents follow the same shape — exit cheaply when nothing new, do the work, record where we scanned to:

```bash
set -uo pipefail

last=$(terminal-cli state get-sha)        # "" on first run

# Fetch main + decide range. On first run, look back 50 commits as the default
# "cold start" window — adjust to taste per agent (a watchdog might want a
# tighter window, a changelog generator a wider one).
git -C "$TERMINAL_REPO" fetch --quiet origin || true
head=$(git -C "$TERMINAL_REPO" rev-parse origin/main 2>/dev/null \
   || git -C "$TERMINAL_REPO" rev-parse origin/master 2>/dev/null \
   || git -C "$TERMINAL_REPO" rev-parse HEAD)
range="${last:-HEAD~50}..$head"

if [ "$head" = "$last" ]; then
  echo "no new commits since $last"
  exit 0
fi

# Whatever the agent does — diff inspection, LLM-escalation, etc.
git -C "$TERMINAL_REPO" log --oneline "$range" -- src/

# … work happens here …

# Record that we've now scanned through origin/main's current tip.
terminal-cli state mark-main
```

### Storing extra fields

Agents can persist anything else they need between runs — last-known coverage %, advisory feed timestamps, finding counts, etc. — under arbitrary keys:

```bash
terminal-cli state set lastCoveragePct 78.4
terminal-cli state set flakeCount 2
prev_pct=$(terminal-cli state get lastCoveragePct)
```

Values are JSON-decoded on read when possible, so booleans, numbers, and arrays round-trip correctly. Treat the state file as **best-effort cache, not source of truth** — if it's missing or stale, the agent should still produce a correct first-run answer (do the full scan, exit 0, mark-main).

### Dedup ledger — for agents that *propose* rather than *detect*

The SHA gate above solves one problem completely and a second one not at all.

It prevents an agent from **re-running** over an unchanged tree. It does nothing
to prevent an agent from **re-proposing** the same idea, because on any repo with
daily commits the gate opens every day. A detector agent doesn't care: it
re-derives its findings from the diff, and an unchanged file yields nothing. But
a *proposer* — an idea agent, a research agent, a refactor-suggester — derives
its output from the whole tree plus its own judgement, so it will cheerfully
re-file "add integration tests for the auth flow" every morning until the backlog
is unusable.

The fix is a **ledger of what has already been proposed and what the human has
already rejected**. It lives in **two files, one per writer**:

```
~/.config/TerMinal/agent-state/<repo>/<agent>.json             # agent-owned
~/.config/TerMinal/agent-state/<repo>/<agent>.dismissed.json   # app-owned
```

```json
// <agent>.json — written ONLY by the agent, via terminal-cli
{
  "lastScannedSha": "abc1234",
  "proposedIdeas": [
    { "key": "auth-flow-integration-tests", "ticket": "0091", "at": 1760000000000 }
  ]
}
```

```json
// <agent>.dismissed.json — written ONLY by the review surface
{
  "dismissed": [
    { "key": "rewrite-settings-in-solidjs", "at": 1760000000000, "reason": "not our direction" }
  ]
}
```

| File | Written by | Meaning |
|---|---|---|
| `<agent>.json` → `proposedIdeas[]` | the agent, on filing | Everything this agent has ever put in front of the human. |
| `<agent>.dismissed.json` → `dismissed[]` | the **review surface**, on Dismiss | Everything the human said no to. Permanent. |

**Two files, not two keys in one file — and this is load-bearing, not
cosmetic.** Every writer here does a read-modify-write of the *whole* JSON
document; there is no field-level update. So if both arrays shared a file, a
04:00 agent run and a 04:00 Dismiss tap would each read the file, each modify
their own array, and each write the whole thing back — and the later write would
silently revert the earlier one. That loses either a just-filed idea or a
just-recorded dismissal, and (worse) can revert `lastScannedSha`, causing a
re-scan of an already-scanned range.

Splitting by writer makes the two processes touch disjoint files, so the race
cannot happen at all. Both writers should still write **atomically** (temp file
+ rename): a plain truncating write that is interrupted leaves an unparseable
ledger, and an unparseable `proposedIdeas` means every previously-rejected idea
comes back. `terminal-cli state set` does this for you.

**The `key` is a slug of the idea's subject, not its phrasing** — otherwise
rewording defeats the ledger. Normalize: lowercase, drop articles and filler
verbs (`add`, `improve`, `refactor`, `consider`), keep the nouns, join with `-`,
truncate to 60 chars. The key is a cheap **exact-match** guard; the agent is
still responsible for a fuzzy near-duplicate check against the live backlog,
since two different phrasings of the same idea can produce two different keys.

Appending to `proposedIdeas` is a read-modify-write of the whole array:

```bash
current=$(terminal-cli state get proposedIdeas)
[ -z "$current" ] && current='[]'
next=$(echo "$current" | jq --arg k "$key" --arg t "$ticket" \
  '. + [{key: $k, ticket: $t, at: (now * 1000 | floor)}]')
terminal-cli state set proposedIdeas "$next"
```

Reading the dismissals means reading the sibling file directly — `terminal-cli
state` only ever touches the agent's own file, which is exactly the point:

```bash
dismissed_file="$HOME/.config/TerMinal/agent-state/$(basename "$TERMINAL_REPO")/$TERMINAL_AGENT_ID.dismissed.json"
dismissed_keys=$(jq -r '(.dismissed // [])[].key' "$dismissed_file" 2>/dev/null)
```

The ledger also gives you a **deterministic daily budget gate** that costs zero
tokens — count entries newer than 24h and exit before ever invoking the engine:

```bash
cutoff=$(( $(date +%s) * 1000 - 86400000 ))
recent=$(terminal-cli state get proposedIdeas | jq --argjson c "$cutoff" \
  '[.[] | select((.at // 0) >= $c)] | length')
[ "$recent" -ge 3 ] && { echo "daily cap reached"; exit 0; }
```

**Fail CLOSED on a corrupt ledger.** Distinguish *absent* (first run — proceed
normally) from *present but unparseable* (something is wrong — file a HITL and
exit 0). Treating a corrupt ledger as empty is the worst option available: it
silently re-proposes every idea the human has ever rejected, which is precisely
the failure the ledger exists to prevent.

**Don't trust the model to write the ledger.** If the append is a step in the
prompt, then an engine that files three tickets and then crashes, or simply
skips the step, leaves the cap permanently disengaged. The *script* should
observe what actually happened — diff the backlog directory before and after the
engine call — and write the ledger itself. Prompt-side appends are a convenience,
never the enforcement.

**When trimming the ledger for prompt size, sort by `at` descending, never
alphabetically.** An alphabetical `sort -u | head -200` silently keeps an
arbitrary slice once the ledger outgrows the cap, so old rejected ideas start
reappearing with no signal.

Unlike the rest of agent-state, **the ledger is closer to source of truth than
to cache.** Losing it doesn't break correctness, but it does mean the human gets
re-asked about things they already rejected — which is the specific failure this
convention exists to prevent. Don't clear it as part of routine maintenance.

Reference implementation: `.agents/ticket-ideas.sh` + `.agents/ticket-ideas.md`.

## Schedule integration

A schedule entry references a `scriptId` (per-repo or global). The existing
`agentId` field stays as a compatibility shim that resolves to a script when
`.agents/<id>.sh` exists. The schedule still owns `engine`, `model`,
`spec`, `enabled`, `lastRun`, etc. The runner now does:

```bash
# inside bin/terminal-cron's runSchedule:
script="$repo/.agents/$id.sh"           # or global
[ -x "$script" ] || die "no script for $id"
script -q /dev/null env \
  TERMINAL_REPO="$repo" TERMINAL_RUN_ID="$run" \
  TERMINAL_ENGINE="$engine" TERMINAL_MODEL="$model" \
  PATH="$TERMINAL_BIN:$PATH" \
  "$script"
```

PTY wrapping (`script -q /dev/null`) stays so claude/codex inside still
stream output to the run log.

## Compatibility & migration

Phase 1 (now):
- The current `.agents/agents.json` + `prompt` model continues to work.
- New: the runner checks for `.agents/<id>.sh` first; if found, executes it
  with the env above; if not, falls back to building `claude -p $prompt`.

Phase 2:
- A `/migrate-agents` skill converts every entry in `.agents/agents.json`
  into a matching `.agents/<id>.sh` + `.agents/<id>.json` sidecar.
- The body of each `.sh` is just the single `claude -p` / `codex exec`
  line built from the prompt + engine + model. After migration the json
  blob is just metadata.

Phase 3:
- `.agents/agents.json` deprecated; readAgents emits a warning when it sees
  one and suggests `/migrate-agents`.

## Designer UX

The designer modal stays the same: user describes what they want in natural
language; claude/codex authors the script. The new bit is the *output*:

- The designer writes both files: `<id>.sh` (executable, chmod 755) +
  `<id>.json` (metadata).
- The preview pane in the modal renders the script body with syntax
  highlighting and the metadata as a card. "Edit" opens the script in the
  Files tab; "Run" spawns it.
- Templates available from a small picker in the designer:
  - **Single LLM call** — the simplest, equivalent to today's agents.
  - **Precheck + escalate** — the health-check-style script above.
  - **Multi-step composition** — sequence of checks with shared state.
  - **Pure deterministic** — no LLM at all (eg. nightly stats roll-up).

A non-technical operator never has to look at the bash; the description
field + template choice cover the common cases.

## UI surface

Add a `Scripts` view in the existing Agents tab (a chip toggle: Agents /
Scripts), or rename Agents → Scripts once migration completes. Each row
shows: title, icon, description, recent runs, last status, **a "script
preview" expander** that shows the bash with syntax highlighting + the
sidecar metadata. Editing opens the file in the Files tab.

The Schedules tab is unchanged — schedules already point at an id; the
underlying file just changed shape.

## What this is not

- **Not** a workflow engine (Temporal, Argo) — single-machine, single-process,
  no retries / DAG semantics beyond what bash gives you.
- **Not** a replacement for `/check <kind>` — `/check` is still the
  convention for scheduled cadence inspections; the scripts that implement
  each kind move to `.agents/<kind>.sh` under this proposal but the
  contract (sole-writer, reports/, etc.) stays.
- **Not** a sandbox — `--dangerously-skip-permissions` is still in play
  for claude calls inside scripts; codex still uses `-s danger-full-access`.
  Trust boundary is unchanged.

## Phase plan

- **Stage A (this file).** Design + migration path locked.
- **Stage B.** Add the runner branch: if `.agents/<id>.sh` exists, exec it
  with the env vars + PTY wrap, capture its stdout/stderr to the run log.
- **Stage C.** Build `terminal-cli` (the helpers exposed inside scripts).
- **Stage D.** `/migrate-agents` skill + Scripts UI view.
- **Stage E.** Deprecate `.agents/agents.json` after a release cycle.

The runtime change is small (it's just `if [-x file] then exec`); the work is
mostly in the helpers + the migration skill + the docs.
