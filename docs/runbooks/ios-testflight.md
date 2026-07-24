# Runbook — TerMinal Remote to internal TestFlight

The repo side is done: XcodeGen project, icon, privacy manifest, store-ready
Info.plist, tests, archive scheme, and an upload script. Below is the human-only
path. Internal TestFlight needs **no App Review**, so a build is testable as
soon as Apple finishes processing it (~15–60 min).

Design rationale: [ADR-0006](../decisions/0006-mobile-terminal-bridge.md) for
the transport and pairing, and
[ADR-0008](../decisions/0008-remote-sessions-register-themselves.md) for the
registration model.

## Prerequisites (once)

- Apple Developer Program membership on the account that owns the app.
  Put your team id in the gitignored `ios/.xcodegen.env`
  (`DEVELOPMENT_TEAM=…` — copy `ios/.xcodegen.env.example`); `project.yml`
  substitutes it at generate time.
- Xcode signed in to that account (Settings → Accounts).
- `brew install xcodegen`.
- App Store Connect API key at
  `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`.

> **The key's role must be Admin.** App Manager can upload builds but *cannot*
> create the cloud-managed distribution certificate, so the first export fails
> with a misleading `No profiles for '<your bundle id>' were found`. The
> real cause only appears in `IDEDistributionProvisioning.log` (path is printed
> in the failure output): Apple returns `403 FORBIDDEN_ERROR — you haven't been
> given access to cloud-managed distribution certificates`. A key's role cannot
> be edited; revoke it and issue a new one.

## 1. App Store Connect record (once)

appstoreconnect.apple.com → Apps → **+ New App**:

- Platform **iOS**, Name **TerMinal Remote**
- Primary language English (U.S.)
- Bundle ID — your `PRODUCT_BUNDLE_ID` from `ios/.xcodegen.env` — register it
  under Certificates → Identifiers if it is not offered in the dropdown
- SKU `terminal-remote-ios`, Full access

Then TestFlight → **Internal Testing** → new group → add yourself. Internal
testers see builds as soon as processing completes.

## 2. Verify before uploading

```sh
cd ios
xcodegen generate
xcodebuild -project TerMinalRemote.xcodeproj -scheme TerMinalRemote \
  -destination 'platform=iOS Simulator,name=iPhone 17' test    # must be green
```

Worth running the live check too — it exercises pinning and auth against a real
bridge, which the offline tests cannot:

```sh
cd ios && ./scripts/e2e-app.sh
```

## 3. Archive + upload

```sh
cd ios
cp .testflight.env.example .testflight.env   # once: ASC_KEY_ID + ASC_ISSUER_ID
./scripts/testflight.sh --bump               # tests → archive → upload
```

`--bump` increments `CURRENT_PROJECT_VERSION` first (build numbers must
strictly increase per upload); `--dry-run` stops after export. Team and bundle
ids are read from the gitignored `ios/.xcodegen.env` (`DEVELOPMENT_TEAM`,
`PRODUCT_BUNDLE_ID`), the single source of truth for Apple identifiers —
`project.yml` only substitutes those variables.

## 4. Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in the Info.plist. That is correct
here: the app uses only standard TLS from the OS. No questionnaire appears.

## 4b. Push notifications (optional, once)

Push is what makes the app genuinely AFK: alerts that reach Telegram reach the
phone too, and tapping one opens that session's thread. The Mac talks to Apple
directly — there is no relay and nothing to pay for.

APNs auth keys cannot be minted through any API, so this step is manual:

1. developer.apple.com → Certificates, Identifiers & Profiles → **Keys** → **+**
2. Name it (e.g. "TerMinal Remote push"), tick **Apple Push Notifications
   service (APNs)**, Continue → Register.
3. Download `AuthKey_<KEYID>.p8`. **It downloads exactly once.**
4. File it:
   ```sh
   cd ios && ./scripts/setup-push.sh ~/Downloads/AuthKey_<KEYID>.p8
   ```
   That copies the key to `~/.config/TerMinal/bridge/apns.p8` (0600) and writes
   `apns.json` with the key id plus the team and bundle ids read from the
   gitignored `ios/.xcodegen.env`.
5. Restart TerMinal, then open the app on the phone once so it registers its
   device token. **Settings → Mobile** then shows the device count.

The environment matters: a Debug build registers against APNs **sandbox**, a
TestFlight build against **production**. Both are recorded per device, so the
same Mac can serve a dev build and a TestFlight build at once. A mismatch is a
silent non-delivery, not an error — if pushes vanish after moving to TestFlight,
this is the first thing to check.

## 5. Install and smoke-test on device

1. Accept the TestFlight invite, install the build.
2. On the Mac: **TerMinal → Settings → Mobile**, toggle the bridge on.
3. Phone and Mac on the same Wi-Fi (or both on the tailnet).
4. Scan the QR.
5. Walk the checklist:
   - On the Mac, run `/remote-terminal` in a session. It appears on the phone.
   - The agent's `post` updates show up in that thread.
   - When it runs `ask`, the row shows **asking** and the thread shows
     "Waiting on your answer".
   - Replying unblocks the agent — `ask` prints your text on its stdout.
   - Replying while it is busy queues; it arrives at the agent's next turn
     boundary via the Stop hook, without anyone polling.
   - A HITL item appears under **Needs you**, and Resolve makes it stay gone.
   - Register a second session: both appear, and replies go to the right one.
   - With push configured: lock the phone, let an agent `ask`, and the
     notification should arrive and open that thread.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Phone can't reach the Mac | Bridge toggle off, Mac asleep, or different network. Settings → Mobile lists the addresses it is reachable at. |
| "This device is no longer paired" | Token was rotated, or the config dir was wiped. Re-scan. |
| Connects, then immediately drops | Certificate changed (bridge identity regenerated). Re-scan — pinning is working as intended. |
| Nothing in the session list | No session has registered. Run `/remote-terminal` in one. |
| A reply never reaches the agent | The Stop hook resolves `terminal-cli` from the repo, then PATH, then `~/.config/TerMinal/bin` — that last copy only syncs at release, so on an unreleased branch it can predate `remote` and no-op silently. |
| Bridge won't start, "port in use" | Something else holds the port. Change it in Settings → Mobile. |
