# Contributing

Thanks for taking a look. TerMinal is a small, hackable Electron app;
contributions of all sizes are welcome.

## Dev Setup

TerMinal is macOS-first. For local development, install:

- [Bun](https://bun.sh)
- Xcode Command Line Tools (`xcode-select --install`)
- At least one engine CLI on your `PATH`: `claude` or `codex`

Optional CLIs enable specific surfaces:

- `gh` for GitHub PRs and CI status
- `glab` for GitLab MRs and CI status
- Telegram bot credentials for notifications and remote control

```bash
git clone https://github.com/trevormil/TerMinal.git
cd TerMinal
git submodule update --init   # optional: vendored references (vendor/)
bun install                   # rebuilds node-pty against Electron's ABI
bun run dev                   # launch the dev build with HMR
```

See [docs/setup.md](docs/setup.md) for engine paths, forge auth, Telegram,
global skills, and fresh-machine setup notes.

## Code Map

- `src/main/` — Electron main process. The bundle is ESM, so do not use
  `__dirname` or CommonJS `require` in runtime paths. Prefer `import.meta` and
  small pure modules with sibling tests.
- `src/preload/index.ts` — the `window.gt` bridge. New IPC needs matching
  changes in main, preload, and renderer types.
- `src/renderer/` — React + Tailwind UI. Tabs auto-discover from
  `tabs/<id>/index.tsx`; cockpit plugins from `plugins/<id>/`.
- `bin/` — packaged helper scripts used by launchd, MCP, and agent scripts.
- `templates/project-template/` — the embedded workflow scaffold bootstrapped
  into new repos.

## Before Opening A PR

Run:

```bash
bun run format      # or format:check — CI enforces prettier
bun run typecheck
bun run test
bun run build
```

For `src/main/`, packaging, PTY, launchd, or IPC changes, also launch the
packaged app and confirm the window opens:

```bash
bun run dist
# or, on macOS when you want to reinstall /Applications/TerMinal.app:
bun run release
```

## Contribution Guidelines

- Keep changes scoped. If you are planning a large redesign, open an issue first.
- Add or update tests for behavior changes. Pure logic is the easiest and most
  valuable place to test.
- Match the existing style and use Conventional Commits:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Do not commit secrets, local config, generated app bundles, or runtime state
  from `~/.config/TerMinal`.
- Treat repo-provided widgets, schedules, and agent scripts as trusted-code
  surfaces. See [SECURITY.md](SECURITY.md) before changing those paths.

## Release Notes

The current public build path is source-first and unsigned. Local contributors
can build a DMG with `bun run dist`; `bun run release` ad-hoc signs and installs
the app locally. Signed/notarized distribution can be added later without
changing the dev workflow.
