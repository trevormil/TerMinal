# ux-taste agent (in-repo contract)

Tier 2 of the UX test suite. Screenshots TerMinal's key surfaces and has a
vision-capable model judge them against the repo's own design language.

Design and rationale: [`docs/ux-testing.md`](../docs/ux-testing.md).
How to run it: [`docs/runbooks/ux-test-suite.md`](../docs/runbooks/ux-test-suite.md).

## Mode

`reporter` — writes an artifact and nothing else. It never opens a PR, never
files a ticket automatically, and **never gates a merge**.

## Cadence

Weekly, or on demand. **Never per-PR.** It is non-deterministic (two runs
disagree) and costs a model call per run. A flaky blocking gate gets disabled
within a week, at which point it is worse than no check at all.

## Inputs

- `tests/ux/surfaces.ts` — the surface list, the design language, and the rubric.
- The sandboxed harness in `tests/ux/` — throwaway `HOME` and
  `TERMINAL_CONFIG_DIR`, every engine binary stubbed. The taste pass can no more
  touch real user state than tier 1 can.

## Process

1. `bun run build` — the suite launches `out/main/index.js`.
2. `bunx playwright test -c playwright.taste.config.ts` captures each surface at a fixed
   1440×900 viewport (fixed so findings are reproducible between runs).
3. `cheapCall` (`src/main/cheap-llm.ts`) hands the image paths, the design
   language and the rubric to the configured coding CLI.
4. Findings are written to `.TerMinal/reports/ux-taste/<short_sha>.md`.

## Output artifact

`.TerMinal/reports/ux-taste/<short_sha>.md`:

```yaml
---
kind: ux-taste
generated: 2026-07-31T12:00:00.000Z
sha: 402f364
surfaces: 10
findings: 7
high_severity: 1
engine: codex
route: codex-exec
status: warn
---
```

Body is one `## <surface>` section per screenshot, with
`- **[high|medium|low]** <what> — <where> — <what to do>` rows, or `- none`.

## Hard rules

1. **Always exit 0.** Including on high-severity findings, and including on its
   own failure. A taste pass that can fail a pipeline is a taste pass that will
   be turned off.
2. **Never per-PR.** Schedule or on demand only.
3. **Advisory.** A human confirms each finding against the screenshot before it
   becomes a ticket. The model is a reviewer, not an oracle.
4. **Sandboxed.** It reuses tier 1's isolation; it must never launch the app
   against a real `HOME`.
