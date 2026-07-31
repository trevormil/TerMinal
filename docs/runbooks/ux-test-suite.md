---
title: Run the UX test suite (tier 1 + tier 2)
last-verified: 2026-07-31
anchor: RB-ux-test-suite
---

# Run the UX test suite

Design, rationale and the blocking decision live in
[`docs/ux-testing.md`](../ux-testing.md). This is the operational sequence.

## [1] Tier 1 — deterministic Playwright

```bash
cd <repo root>
bun install
bun run build          # REQUIRED: the suite launches out/main/index.js
bun run test:ux
```

Expect **15 passing tests in ~1.5 min**. The window never appears — the suite is
headless by default (`show: false` under `TERMINAL_HEADLESS=1`). Nothing steals
focus, so it is safe to run while you are working.

Rebuild before every run after touching `src/`. A stale `out/` silently tests
the previous commit — the most likely way to be confused by this suite.

### [1.1] Watch a failing test

```bash
bun run test:ux:headed                      # window visible
bunx playwright test --project=ux tabs.spec.ts   # one spec
bunx playwright test --project=ux --debug        # step through
```

Failure artifacts land in `test-results/` (gitignored). CI uploads the same
directory as the `ux-suite-results` artifact for 7 days.

### [1.2] Strict pollution check

The canary warns rather than fails locally, because a running TerMinal writes to
`~/.config/TerMinal` continuously. To check for real:

1. Quit TerMinal (and any `terminal-cron` / MCP server writing to that dir).
2. `TERMINAL_UX_STRICT_CANARY=1 bun run test:ux`
3. A failure here means something bypassed the sandbox. **Find the write — do
   not weaken the assertion.** Start with `src/main/config-dir.ts` and whichever
   module the failing test touched.

`sandbox.spec.ts` is strict at all times and needs no special setup.

## [2] Tier 2 — the AI taste pass

Cadence, **never** a gate. Run it weekly, or before a release, or when a surface
has changed a lot.

```bash
bun run ux:taste                    # screenshots + model call + report
bun run ux:taste -- --capture-only  # screenshots only — no spend
bun run ux:taste -- --engine=claude --model=sonnet
```

It writes `.TerMinal/reports/ux-taste/<sha>.md` and the screenshots it judged to
`.TerMinal/reports/ux-taste/screens/<sha>/`. Open the **Reports tab** to read it.

It always exits 0, including when it finds high-severity problems. That is
deliberate: a non-deterministic check that can fail a pipeline gets turned off.

### [2.1] Triage the output

1. Read the report in the Reports tab.
2. For each `**high**` finding, open the named screenshot and confirm it with
   your own eyes — the model is a reviewer, not an oracle.
3. File a ticket for anything confirmed. Ignore the rest; do not argue with it.

### [2.2] Schedule it

Add a schedule for the `ux-taste` agent (`.agents/ux-taste.sh`) from the
**Schedules** tab, or run `/new-schedule`. Weekly is the intended cadence.

## [3] When it breaks

| Symptom | Cause | Fix |
|---|---|---|
| `waiting for locator('[data-tab-id="terminal"]')` times out | `out/` is stale or missing | `bun run build` |
| `every registered tab is reachable` fails with a new id | a tab was added whose `appliesTo()` the fixture repo does not satisfy | extend `tests/ux/fixture-repo.ts` so the fixture satisfies it — do **not** add the id to an exclusion list |
| `no session can spawn a real agent CLI` fails | the engine-path override was bypassed | check `settings.engines.<id>.path` handling; this one is a real incident, not a test bug |
| the canary fails on CI | something resolved the real home | see [1.2] |
| a tab shows only "Loading…" | a badge or mount effect is polling an unhandled IPC channel | this is the bake-off defect — the suite is working |
