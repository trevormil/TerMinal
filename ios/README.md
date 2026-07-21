# TerMinal Remote — iOS

A native SwiftUI client (iOS 17+) that mirrors and drives the live terminal
sessions running in TerMinal on your Mac. Point it at the Mac, pick a session,
watch the agent work, and type back.

**Chat first, terminal underneath.** The home screen is one conversation per
session — the Telegram AFK experience, except per-session and in the app where
you can act. The mirrored terminal is one tap away for anything the chat cannot
express. There are still no bespoke screens for tickets or PRs: ask the agent.

## How it connects

The Mac runs an HTTPS + SSE bridge in TerMinal's main process
(`src/main/bridge/`), off by default. Turning it on in **Settings → Mobile**
generates a bearer token and a self-signed certificate, then shows a QR code:

```
{ "v":1, "n":"Trevor's MacBook", "p":8790,
  "h":["100.126.73.11","192.168.1.42"], "t":"<token>", "fp":"<sha256 of cert>" }
```

- **`fp` is pinned.** The app accepts exactly that certificate and no other
  (`PinnedTrust.swift`) — stronger than CA validation, since no third party can
  mint a certificate this client would trust.
- **`h` is raced.** The tailnet address comes first, so the phone keeps working
  off the home network; it falls back to the LAN address.
- **`t` rides on every request.** Rotating it in Settings unpairs every device.

Geometry is **mirrored, never driven**: the phone renders at the Mac's own
cols×rows and pinch-zooms, because resizing the pty would rewrap the terminal
the human is looking at on the desktop.

## Architecture

```
TerMinalRemote/
  App/          TerMinalRemoteApp + RootView (paired ? chats : pairing),
                PushRegistrar (APNs token → the Mac)
  Chat/         ChatListView (threads + HITL queue), ChatThreadView,
                NewSessionSheet, ChatModels
  Design/       Theme.swift — TerMinal's tokens, ported from index.css
  Pairing/      PairingPayload (validated QR contents), PairingStore (Keychain),
                PairingView (scan or paste), QRScannerView (AVFoundation)
  Networking/   BridgeClient (async/await, host racing), PinnedTrust
                (certificate pinning), SSE (frame parser + protocol decode)
  Sessions/     SessionListView, SessionViewModel (stream → terminal)
  Terminal/     TerminalMirrorView (SwiftTerm in a zoomable scroll view),
                TerminalScreen, KeyBar (esc / ^C / ^D / tab / arrows / ⏎)
TerMinalRemoteTests/   Pairing validation, SSE framing, fingerprint pinning
```

SwiftTerm (MIT, pinned to 1.15.0) is the only third-party dependency.

## Open & run

```sh
brew install xcodegen          # once
cd ios
xcodegen generate              # the .xcodeproj is gitignored — a build artifact
open TerMinalRemote.xcodeproj
```

SwiftTerm ships a Metal shader, so a first build may need:
`xcodebuild -downloadComponent MetalToolchain`.

## Tests

```sh
cd ios
xcodegen generate
xcodebuild -project TerMinalRemote.xcodeproj -scheme TerMinalRemote \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

All offline — no network, no camera, no simulator entitlements needed.

## Testing without rebuilding the desktop app

`ios/scripts/e2e-bridge.ts` starts the same bridge against a real bash pty and
prints a scannable QR in the terminal, so you can drive a live shell from the
phone without touching your installed TerMinal:

```sh
bun ios/scripts/e2e-bridge.ts     # scan the QR it prints
bun ios/scripts/e2e-bridge.ts --selftest   # assert the round trip, then exit
```

It advertises the tailnet address first, then the LAN one, then 127.0.0.1 for
the Simulator. Port 8791, never 8790, so it can't collide with a real TerMinal.

## Pairing in the Simulator

The Simulator has no camera, so the scanner reports "No camera available". Use
**Copy pairing code** in TerMinal → Settings → Mobile, paste it into the
Simulator (⌘V works into the paste sheet), and tap **Pair**.

## TestFlight

```sh
cd ios
cp .testflight.env.example .testflight.env   # once: ASC_KEY_ID + ASC_ISSUER_ID
./scripts/testflight.sh --bump               # tests → archive → upload
```

Full human path (App Store Connect record, tester group, the Admin-role key
gotcha) is in
[`docs/runbooks/ios-testflight.md`](../docs/runbooks/ios-testflight.md).
