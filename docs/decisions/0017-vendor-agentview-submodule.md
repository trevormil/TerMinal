# 17. `vendor/agentview` is a reference checkout, not a dependency

Date: 2026-07-31

Status: accepted

## Context

`.gitmodules` carries a second submodule besides the template
([ADR-0005](0005-embed-project-template.md)):

```
[submodule "vendor/agentview"]
	path = vendor/agentview
	url = https://github.com/the-real-adammork/agentview
```

It is third-party, pinned to a bare commit (`d6933cf`) on someone else's `main`,
and it arrived without explanation — inside a bundled WIP commit (`f6b0d14`,
2026-06-12) whose message never mentions it. A reader today reasonably assumes
TerMinal depends on it, because the Observability tab talks to IPC channels
literally named `agentview:snapshot`, `agentview:session`,
`agentview:tool-call`, `agentview:transcript-window`.

It does not. Those handlers are TerMinal's own code
(`readObservabilitySnapshot` and friends in `src/main/data.ts`); the name is
lineage, not linkage. **Nothing under `src/` imports anything from
`vendor/agentview`**, the checkout is not initialized (`git submodule status`
shows a leading `-`), CI never fetches submodules for the test job, and
`electron-builder.yml` does not package it.

Its only footprint on the repo is friction: `bunfig.toml` has to scope
`bun test` to `root = "src"` so a bare `bun test` in an initialized checkout
doesn't descend into the vendored tree and report a stranger's failing tests as
ours.

## Decision

Record it for what it is and constrain it accordingly.

- **Reference only.** `vendor/agentview` exists so its approach to reading agent
  transcripts can be read alongside ours. It is **never** imported, bundled,
  executed, or packaged. Any change that would make the app depend on it needs
  its own ADR first.
- **Pinned to a SHA, deliberately.** A submodule tracks a commit, not a branch,
  so the pin cannot move without a commit here — the same "no floating versions"
  rule as CLAUDE.md §10, obtained for free. It is *not* kept current: bumping it
  is a deliberate act with a reason in the commit message, not maintenance.
- **Not initialized by default.** `git clone` without `--recurse-submodules`
  leaves it empty and everything works; contributors never need it. Only
  `release.yml` uses `submodules: true`, and only for the template's sha.
- **If it goes away, so do we.** Because nothing depends on it, an abandoned,
  deleted, or compromised upstream costs a `git rm` — no fork, no vendoring. That
  is the whole abandonment plan, and it is why keeping the dependency at zero is
  the point rather than an accident.

## Consequences

- The supply-chain surface is a directory that is never fetched, never built and
  never shipped. An upstream compromise cannot reach a user's machine through
  TerMinal.
- The `agentview:*` IPC channel names now have a written explanation, so nobody
  concludes the submodule is load-bearing and "fixes" the build to include it.
- `bunfig.toml`'s `root = "src"` is a permanent consequence of keeping a foreign
  tree in-repo, not a workaround to be cleaned up.
- The honest alternative is deletion — it earns its keep only as reading
  material, and if that stops being true it should go. This ADR is the trigger to
  revisit rather than a commitment to keep it forever.
