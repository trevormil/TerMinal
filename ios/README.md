# TerMinal Remote — iOS

A native SwiftUI client (iOS 17+) for following and steering the agent sessions
you have opted in to on your Mac.

**Sessions register themselves.** Run `/remote-terminal` in a session and it
appears on the phone; sessions that never register are invisible. The agent
posts what it wants you to see and reads what you send back — nothing is
scraped, and the phone never touches a terminal. That is why this works
identically for claude, codex, or anything else that can run a shell command.

## How it connects

TerMinal's main process runs an HTTPS bridge (`src/main/bridge/`), off by
default. Turning it on in **Settings → Mobile** generates a bearer token and a
self-signed certificate, then shows a QR code:

```
{ "v":1, "n":"My Mac", "p":8790,
  "h":["100.100.1.2","192.168.1.42"], "t":"<token>", "fp":"<sha256 of cert>" }
```

- **`fp` is pinned.** The app accepts exactly that certificate and no other
  (`PinnedTrust.swift`) — stronger than CA validation, since no third party can
  mint a certificate this client would trust.
- **`h` is raced.** The tailnet address comes first, so the phone keeps working
  off the home network; it falls back to the LAN address.
- **`t` rides on every request.** Rotating it in Settings unpairs every device.

## Architecture

```
TerMinalRemote/
  App/          TerMinalRemoteApp + RootView (paired ? sessions : pairing),
                PushRegistrar (APNs token → the Mac)
  Pairing/      PairingPayload (validated QR contents), PairingStore (Keychain),
                PairingView (scan or paste), QRScannerView (AVFoundation)
  Networking/   BridgeClient (async/await, host racing), PinnedTrust
  Remote/       RemoteListView (sessions + HITL queue), RemoteThreadView,
                RemoteModels
  Design/       Theme.swift — TerMinal's tokens, ported from index.css
  Fonts/        IBM Plex Sans + Mono (OFL, see LICENSE.txt)
TerMinalRemoteTests/  pairing validation, certificate pinning, font
                      registration, and live tests against a running bridge
```

No third-party Swift dependencies.

## Open & run

```sh
brew install xcodegen          # once
cd ios
xcodegen generate              # the .xcodeproj is gitignored — a build artifact
open TerMinalRemote.xcodeproj
```

## Tests

```sh
cd ios
xcodegen generate
xcodebuild -project TerMinalRemote.xcodeproj -scheme TerMinalRemote \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

The live-bridge tests skip themselves unless the harness below is running; the
rest are offline.

## Driving it without the desktop app

`ios/scripts/e2e-bridge.ts` serves the real remote-session store over the same
bridge and prints a scannable QR, so anything registered with
`terminal-cli remote register` shows up on the phone without running TerMinal:

```sh
bun ios/scripts/e2e-bridge.ts              # scan the QR it prints
bun ios/scripts/e2e-bridge.ts --selftest   # assert the round trip, then exit
```

It advertises the tailnet address first, then the LAN one, then 127.0.0.1 for
the Simulator. Port 8791, never 8790, so it cannot collide with a real TerMinal.

`ios/scripts/e2e-app.sh` runs the app in a Simulator against that harness.

## Pairing in the Simulator

The Simulator has no camera, so the scanner reports "No camera available". Use
**Copy pairing code** in TerMinal → Settings → Mobile, paste it into the
Simulator, and tap **Pair**.

## TestFlight

```sh
cd ios
cp .testflight.env.example .testflight.env   # once: ASC_KEY_ID + ASC_ISSUER_ID
./scripts/testflight.sh --bump               # tests → archive → upload
```

Full human path (App Store Connect record, tester group, APNs key, the
Admin-role key gotcha) is in
[`docs/runbooks/ios-testflight.md`](../docs/runbooks/ios-testflight.md).
