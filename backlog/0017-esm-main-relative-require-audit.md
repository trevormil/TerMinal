---
id: 17
title: "Kill the last two require('./x') calls in ESM main + add a lint guard"
status: closed
priority: medium
horizon: next
hitl: false
type: bug
source: manual
created: 2026-07-08
updated: 2026-07-09
prs: []
refs: []
depends_on: []
acceptance:
  - "events.ts:187 and agents.ts:1351 use static imports; no require('./ relative call remains under src/main"
  - "A check (lint rule or bun test) fails when a relative require is reintroduced under src/main"
  - "grep -cE 'require\\(\"\\./' on the built out/main/index.js returns 0"
agent_id: 1000x-ai-engineer
agent_scope: global
agent_kind: classic
---

## Description

`src/main` bundles to ESM. The `createRequire(import.meta.url)` shim in the
emitted bundle resolves relative specifiers against `out/main/index.js`, where
no sibling modules are emitted — so **every** `require('./sibling')` in main
throws `MODULE_NOT_FOUND` in the packaged app.

Verified against the built bundle:

```
$ cd out/main && node --input-type=module -e "
  import { createRequire } from 'node:module'
  createRequire('file://'+process.cwd()+'/index.js')('./bg-tasks')"
THROWS: MODULE_NOT_FOUND — Cannot find module './bg-tasks'
```

The `telegram.ts` and `bg-tasks.ts` occurrences were fixed while shipping
`/feature` (see `docs/implementation-notes.md`, 2026-07-08). Two remain. Both
are wrapped in `try`/`catch`, so they degrade silently rather than crash — which
is exactly why they went unnoticed.

## Remaining sites

| File | Call | Silent consequence in the packaged app |
|---|---|---|
| `src/main/events.ts:187` | `require('./event-classifier')` | Activity events never get LLM kind-inference; always fall back to the heuristic. |
| `src/main/agents.ts:1351` | `require('./ai-collectors')` | `recordRunnerInvocation` never fires — agent-run token/cost attribution is under-recorded. |

## Why a lint guard

Three of these accumulated independently, each with a plausible-sounding comment
("lazy require to avoid pulling X into tests"). The rationale was stale in every
case. A grep-based check is cheap and prevents the class.

Same root cause as the packaged ESM-main `__dirname` gotcha already
documented in CLAUDE.md.
