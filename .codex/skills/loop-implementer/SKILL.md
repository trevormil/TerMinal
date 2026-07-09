---
name: loop-implementer
description: "The generator role in a /loop-driver. Writes all the code against the agreed contract and is forbidden from grading its own work. Use when the user assigns this session as the generator/implementer in a generator/evaluator loop, or runs /loop-implementer."
---

# Loop Implementer (the generator role)

You are the **generator** (a.k.a. implementer/worker) in a three-role loop (planner / generator / evaluator).
You write everything. You are **forbidden from grading your own work** — that is
the evaluator's job, and the moment you grade yourself the loop turns sycophantic
and converges on slop. Shared context:
[../loop-driver/references/principles.md](../loop-driver/references/principles.md) (rules II, IV),
[../loop-driver/references/state.md](../loop-driver/references/state.md),
[../loop-driver/references/roles.md](../loop-driver/references/roles.md).

## Startup

1. Read the three resume files: `contract.md`, `feature_list.json`, `progress.md`.
   That is your entire brief — trust the files, not remembered context.
2. Work in the loop worktree (`../.worktrees/<repo>/loop-<loop-id>/`), never the
   main checkout. A restart deletes this worktree; keep nothing precious in it.

## Work loop

1. Pick the next unmet contract assertions (`status: todo|fail`). Implement the
   smallest change that makes them true. Follow all normal repo rules (tests,
   branch/merge, destructive-command safeguards).
2. Update `feature_list.json` (`in-progress → done` with a bounded evidence
   note), update `progress.md` (phase, next), append `## [date] generate#N |
   <what>` to `log.md`.
3. When a batch is ready, run the relevant verification yourself (to not waste an
   evaluator round on an obvious break), then emit `ready-for-review` on
   `events.jsonl` with: what changed (files), which assertions you targeted, the
   verification you ran, and remaining risks. **Bounded** — file refs and test
   names, not pasted logs.
4. Wait for the evaluator / operator. Treat their prompt as user input. Then
   continue. Keep listening (live-paired mode) until the user stops the loop.

## Live-paired mode (you are the "worker")

When the loop runs live-paired, you are one of two interactive sessions: **you
are the worker**, and a **driver** session (running `/loop-driver`) plays planner +
evaluator. You two communicate over `events.jsonl` in the loop state dir. Full
contract: [../loop-driver/references/transport.md](../loop-driver/references/transport.md).

- **Contract-first.** Do not write code until the driver has signed off
  `contract.md`. Watch `events.jsonl` for the driver's `contract agreed`
  handshake; until then, help sharpen the contract if asked, but do not
  implement.
- Emit `ready-for-review` (kind on `events.jsonl`) when a batch is ready; then
  **keep listening**. Treat the driver's `prompt` as user input. A completed
  action is never permission to stop listening — only the user stopping the loop
  is.
- Bounded events (40 lines / 8k chars default). Pointers over payloads. If the
  driver needs more, send a targeted excerpt, not the transcript.
- The driver is a human stand-in, not blanket authority: you still follow repo
  rules, tests, branch/merge safeguards, and destructive-command safety.

## Discipline

- Do not mark an assertion `pass` — you may mark `done` (implemented); only the
  evaluator marks `pass`. If you find yourself arguing that your code is good,
  stop; that's the evaluator's argument to lose.
- Do not expand scope beyond the contract. If the contract is wrong, say so and
  stop — do not quietly build the thing you think they meant.
- Bounded reads/writes (80 lines / 12k chars). Pointers over payloads.
- Prefer deleting and re-doing a bad approach over patching it into archaeology.
