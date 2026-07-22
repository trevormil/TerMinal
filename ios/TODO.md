# TerMinal Remote — feature checklist

Living list for the iOS remote app. Check items off as they land; add freely.

## Done

- [x] Tailnet pairing (root cause: `NSAllowsLocalNetworking` suppressing
      `NSAllowsArbitraryLoads` blocked the tailnet CGNAT range — dropped it)
- [x] Remember paired Macs — tap to re-pair instead of retyping the address
- [x] New Session sheet: explicit Start button + keyboard dismissal
- [x] Chat renders Markdown + accepts images/screenshots
- [x] Registration model: a session opts in via `/remote-terminal`, engine-agnostic

## In progress

- [ ] **New Session end-to-end** — renderer now subscribes to `remote:open-session`
      (was unwired: spawn registered a thread but never launched an agent, so
      nothing replied). Verify against the REAL app that a spawned agent actually
      registers the remote id, runs the task, and posts back. The harness cannot
      run a real agent — New Session must be tested against `bun run dev` or the
      installed app.

## Backlog

- [ ] **Unpair / switch-Mac button** in the app (today you can only re-pair from
      the unpaired state)
- [ ] **Reply-delivery hook reachability** — the `remote-check.sh` Stop hook must
      be active in ANY repo a session is spawned in, not just the TerMinal repo,
      or phone→agent replies won't reach sessions started elsewhere. Likely needs
      the hook installed globally (`~/.claude/settings.json`).
- [ ] **`terminal-cli` on PATH for spawned sessions** — spawnPrompt calls bare
      `terminal-cli`; confirm it resolves inside an arbitrary repo (helios, etc.),
      else the agent can't post.
- [ ] **APNs push** — dormant until the APNs key is created
      (`ios/scripts/setup-push.sh`)
- [ ] **Full tailnet fleet picker** — show ALL your Macs (via the Mac's
      `tailscale status`), not only ones you've paired with. Bigger: needs a
      tailnet-gated `/v1/tailnet` endpoint + a bootstrap for the first machine.
- [ ] Auto-scroll the selected repo into view in New Session (minor polish)
- [ ] Harness `spawn` only simulates a launch; real desktop tab happens in the app
