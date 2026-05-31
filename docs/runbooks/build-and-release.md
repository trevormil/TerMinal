---
title: Build & package the macOS app
last-verified: 2026-05-28
---

# Build & package (macOS)

Produce a branded, double-clickable `TerMinal.app` you can drop in
`/Applications` and pin to the Dock. Set `TERMINAL_APP_DEST` if you want to
install somewhere else, such as a per-user `~/Applications/TerMinal.app`.

## One shot

```bash
bun run dist
```

This runs `electron-vite build` then `electron-builder --mac` (config:
`electron-builder.yml`). Outputs to `dist/`:

- `dist/mac-arm64/TerMinal.app` — the app bundle
- `dist/TerMinal-<version>-arm64.dmg` — a draggable installer

The app icon comes from `build/icon.icns` (regenerate from `build/icon.png` with
`iconutil` if you change the logo).

## Make it launchable + install it

The build is **unsigned** (`identity: null` — no Apple Developer cert). On Apple
Silicon an unsigned bundle whose signature wasn't re-applied trips "app is
damaged". Re-sign deep ad-hoc, then install:

```bash
APP="dist/mac-arm64/TerMinal.app"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"   # should exit 0, no output
rm -rf "/Applications/TerMinal.app"
cp -R "$APP" /Applications/
xattr -cr "/Applications/TerMinal.app"
open "/Applications/TerMinal.app"   # right-click → Open the first time (Gatekeeper)
```

Then right-click the Dock icon → **Options → Keep in Dock**.

`bun run release` automates the same sequence and installs to
`/Applications/TerMinal.app` by default:

```bash
bun run release
TERMINAL_APP_DEST="$HOME/Applications/TerMinal.app" bun run release
```

## Notes

- The packaged app is a **snapshot**. After code changes, re-run `bun run dist`
  and reinstall.
- `templates/` and `bin/` are **not** bundled into the app (electron-builder
  ships only `out/**` + `package.json`). The in-app "New project from template"
  flow clones project-template at runtime when the submodule isn't present.
- Sharing the `.dmg` to another Mac: that machine will quarantine it — the
  recipient needs right-click → Open (or `xattr -cr`) the first time.
- Dev runs (`bun run dev`) and the installed app can run side by side; the dev
  build reflects live code, the installed app is the frozen snapshot.
