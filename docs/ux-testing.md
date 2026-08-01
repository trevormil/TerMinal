---
anchor: UXT
---

# [1] The UX test suite

TerMinal's UI is the product, and until now it was the only part of the app with
no automated tests. Six visible UX defects shipped in a single day, every one of
them with a green 1868-test suite, a clean typecheck and adversarial review
behind it. Each was found by a human opening the app.

The pattern: **unit tests verify that a component returns something; they cannot
verify what a human sees.** This suite closes that gap in two tiers with
deliberately different cadences.

| | Tier 1 — Playwright | Tier 2 — AI taste pass |
|---|---|---|
| Asserts | facts | judgement |
| Cadence | every PR | schedule / on demand |
| Gates a merge | not yet ([4]) | **never** |
| Cost | a step on an existing macOS job | one model call per run |
| Output | pass/fail | a Reports-tab artifact |

## [1.1] Running it locally

```bash
bun run build          # tier 1 launches out/main/index.js — build first
bun run test:ux        # tier 1, headless (~1.5 min)
bun run test:ux:headed # same, with the window visible — for debugging
bun run ux:taste       # tier 2: screenshots + a model call + a report
bun run ux:taste --capture-only   # tier 2 screenshots only, no model call
```

`bun run test:ux` is headless by default. TerMinal is a daily driver: a suite
that throws a window in front of you mid-work, or steals focus eleven times
while it clicks through tabs, is a suite you stop running. Use
`test:ux:headed` when a test fails and you want to watch it.

**Headless here means hidden, not non-rendering.** Electron has no true headless
mode, so `src/main/index.ts` reads `TERMINAL_HEADLESS=1` and passes
`show: false` to the `BrowserWindow`. The renderer runs and paints exactly as
normal — every assertion and every tier-2 screenshot still works — the window
simply never appears. It is opt-in via env, so production behaviour is
unchanged.

## [2] Tier 1 — deterministic Playwright

`playwright.config.ts` → `tests/ux/`. Playwright drives the real Electron main
process via `_electron.launch()`; **no browser binaries are downloaded and there
is no `playwright install` step**, in CI or locally.

What it covers, and why each one is there:

| Spec | Assertion | The defect it exists for |
|---|---|---|
| `launch.spec.ts` | the app opens a window, reaches the session UI, and boots with no console errors, uncaught exceptions or unhandled rejections | the ESM-main class of failure, where the app dies before painting and typecheck/tests/bundler all stay green |
| `tabs.spec.ts` | **every** registered tab is in the tab bar, and opening each one produces no error and leaves a pane that is neither blank nor stuck on "Loading…" | the bake-off tab that shipped visibly broken: auto-registered, badge polling an unhandled IPC channel, hung on "Loading…" forever |
| `ipc.spec.ts` | every channel the preload can invoke is registered in the **running** main process | `src/main/ipc/registrars.test.ts` asserts this from source text and broke on merge twice — source says a handler exists, not that `index.ts` reached the line registering it |
| `flows.spec.ts` | a ticket opens and its Ticket/Lineage/Log strip switches; the Plugins drawer shows the repo's literal commands untruncated; the MRs list renders | approve-time command truncation (a command you must drag sideways to read is a command you approve unread) |
| `layout.spec.ts` | no horizontal page overflow at the minimum window width; no invisible block eating vertical space; an empty list still renders legible text | the iOS Inbox phantom margin — a reviewer read the empty state as invisible; the row around it still carried insets |
| `sandbox.spec.ts` | the launched app's `HOME`, config dir and `userData` are all temp dirs, and no session can spawn a real agent CLI | see [3] |

The tab enumeration comes from the **filesystem** (`src/renderer/src/tabs/*/`),
cross-checked against the exclusion list parsed out of `registry.ts`. A tab
added tomorrow is covered tomorrow without anyone editing this suite. That is
the single highest-value property in it.

### [2.1] Selectors

The suite prefers roles and stable attributes over DOM structure, because the UI
is under continuous change:

- `[data-tab-id="<id>"]` on the primary tab pills, with `aria-current="page"` on
  the active one. The visible label is forge-dependent ("PRs" vs "MRs"), so
  names are not reliable.
- `[data-tab-pane="<id>"]` on the active full-screen pane. Several panes stay
  mounted at once, so `body` would mask a tab that rendered nothing.
- `getByRole('tab')` / `aria-selected` for `components/DetailTabs.tsx`, the
  canonical detail tab strip.

## [3] Isolation — the non-negotiable part

Test pollution of real user state happened **three times in one day**: a global
agent registry overwritten twice, and a suite that shelled out to the real
`claude` CLI twenty times per run against a paid subscription.

Every launch (`tests/ux/isolation.ts`) gets:

- a throwaway `HOME` **and** `CFFIXED_USER_HOME` — CoreFoundation's
  `NSHomeDirectory()` ignores `$HOME`, so Electron's `userData` would otherwise
  still land in the real home;
- a throwaway `TERMINAL_CONFIG_DIR` (`src/main/config-dir.ts`);
- a throwaway `XDG_CONFIG_HOME`;
- **every engine binary pinned to a stub shell script**, so no session can spawn
  `claude`, `codex` or `cursor-agent` at all. `sandbox.spec.ts` proves it by
  asserting the stub's marker appears in the terminal.

Two independent checks keep it honest:

1. **`sandbox.spec.ts` — the mechanism.** Asserts inside the running main
   process that `app.getPath('home')`, `userData`, `appData`, `$HOME` and
   `$TERMINAL_CONFIG_DIR` are all under the OS temp dir. If those hold, no code
   path can reach real state — including the ~52 that still bake `homedir()` in
   rather than going through the config-dir seam (ticket 108). This is strict
   everywhere and is unaffected by anything else running on the machine.

2. **The canary — the symptom.** `canary.setup.ts` fingerprints the real
   `~/.config/TerMinal` (every path, size and mtime) before the run;
   `canary.check.ts` re-checks after, as the setup project's teardown.
   - **On CI it is strict**: the directory does not exist there and nothing else
     is running, so any difference fails the run.
   - **Locally it warns rather than fails**, because TerMinal is a daily driver
     and is *running while the suite runs* — its activity feed, statusline and
     AI-run collectors write to that directory continuously, so a strict diff
     would be a guaranteed false positive, and a canary that cries wolf gets
     deleted. Quit TerMinal and run
     `TERMINAL_UX_STRICT_CANARY=1 bun run test:ux` for a real local check.

## [4] Tier 1 in CI, and the blocking decision

Tier 1 runs as a step inside the **existing `package-smoke` job** on `macos-15`,
not as a job of its own. That job has already paid for the checkout, the full
install with the native rebuild, and the `out/` bundle the suite launches; a
separate macOS job would double a 10x-billed cost to re-derive the same
artifacts.

It is currently **`continue-on-error: true` — non-blocking, deliberately and
with an end date.** Every assertion is deterministic and the suite is green
locally, but it has never run on a hosted runner, and a blocking gate that turns
out to be flaky on a 10x-billed runner is a tax on every future PR — and gets
disabled within a week, at which point it is worse than nothing. The step still
runs on every PR and its failures are visible in the log and in the uploaded
`test-results/` artifact.

**Flip it to blocking** (`continue-on-error: false`) once it has roughly a week
of clean runs on `main`. If it is *not* clean by then, the answer is to fix the
flake, not to leave a permanent soft gate.

## [5] Tier 2 — the AI taste pass

`bun run ux:taste` → `scripts/ux-taste.ts`.

1. Screenshots the key surfaces (`tests/ux/surfaces.ts`) via the same sandboxed
   harness tier 1 uses, at a fixed 1440×900 viewport so findings are
   reproducible.
2. Hands them, plus a rubric and **this repo's own design language**, to a
   vision-capable coding CLI through the existing cheap-LLM path
   (`src/main/cheap-llm.ts`) — no new provider integration.
3. Writes `.TerMinal/reports/ux-taste/<sha>.md` with the standard report
   frontmatter (`kind`, `generated`, `sha`, `findings`, `status`), so it shows
   up in the **Reports tab** next to every other agent artifact.

It judges what assertions cannot: cramped controls, truncation, dead space,
inconsistent chip and tab treatment, and whether an empty state reads as
"nothing here" or as "still loading". Feeding it the design language
(`DESIGN_LANGUAGE` in `tests/ux/surfaces.ts`, anchored on
`components/DetailTabs.tsx`) is what makes it flag *inconsistency* rather than
generic ugliness.

**It never gates a merge, and it never runs per-PR.** It is non-deterministic —
two runs disagree — and it costs money. `scripts/ux-taste.ts` always exits 0 for
exactly that reason. Read the report; triage the findings into tickets.

```bash
bun run ux:taste                      # default engine: codex
bun run ux:taste -- --engine=claude --model=sonnet
bun run ux:taste -- --capture-only    # screenshots only, no spend
```

Schedule it from the Schedules tab, or via `.agents/ux-taste.sh`.

## [6] What this suite is not

It is **not** coverage, on purpose. It proves the harness works and covers the
flows whose defects actually shipped. A suite nobody trusts is worse than no
suite, so it grows one deliberate test at a time — each one traceable to a
defect a human found by opening the app.
