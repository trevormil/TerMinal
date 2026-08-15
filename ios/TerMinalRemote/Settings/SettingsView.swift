import SwiftUI
import UserNotifications

/// The Settings tab: what Mac this phone is paired with, notification state,
/// app version, and the one destructive action — unpair.
struct SettingsView: View {
    let pairing: PairingPayload
    let client: BridgeClient
    let onUnpair: () -> Void
    /// Called when the fleet picker pairs with a different Mac.
    let onSwitch: (PairingPayload) -> Void

    @State private var notifStatus: UNAuthorizationStatus?
    @State private var hook: GlobalHookStatus?
    @State private var hookBusy = false
    @State private var hookMessage: String?
    @State private var confirmingUnpair = false
    @State private var lock = AppLock.shared
    @State private var settingPasscode = false
    @State private var confirmingLockOff = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    section("Paired Mac") { pairedMacPanel }
                    section("Fleet") { fleetPanel }
                    section("Listener hook") { hookPanel }
                    section("App lock") { appLockPanel }
                    section("Notifications") { notificationsPanel }
                    section("About") { aboutPanel }

                    Button(role: .destructive) {
                        confirmingUnpair = true
                    } label: {
                        Text("Unpair this Mac")
                            .font(GT.sans(14, .medium))
                            .foregroundStyle(GT.red)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(GT.red.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(GT.red.opacity(0.35), lineWidth: 1)
                            )
                    }
                    .padding(.top, 8)
                }
                .padding(14)
            }
            .refreshable { await refreshNotifStatus() }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .confirmationDialog(
            "Unpair this Mac? You'll need the pairing code to reconnect.",
            isPresented: $confirmingUnpair,
            titleVisibility: .visible
        ) {
            Button("Unpair", role: .destructive, action: onUnpair)
            Button("Cancel", role: .cancel) {}
        }
        .task { await refreshNotifStatus() }
        .task { await refreshHook() }
        // Coming back from iOS Settings should reflect a changed permission.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshNotifStatus() } }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        Text(title.uppercased())
            .font(GT.sans(10, .semibold))
            .tracking(0.8)
            .foregroundStyle(GT.textFaint)
            .padding(.top, 4)
        content()
    }

    private var pairedMacPanel: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: "desktopcomputer")
                        .font(.system(size: 15))
                        .foregroundStyle(GT.accentLight)
                    Text(pairing.n)
                        .font(GT.sans(15, .medium))
                        .foregroundStyle(GT.text)
                }
                Divider().overlay(GT.border)
                row("Port", String(pairing.p))
                ForEach(Array(pairing.h.enumerated()), id: \.offset) { i, host in
                    row(i == 0 ? "Hosts" : "", host)
                }
                row("Certificate", fingerprintPrefix)
            }
        }
    }

    /// Every Mac on the tailnet, one tap from taking over this phone. Reached
    /// through the Mac you are already paired with, so there is no second
    /// pairing bootstrap to solve.
    private var fleetPanel: some View {
        NavigationLink {
            FleetView(
                model: FleetViewModel(client: client, port: pairing.p), onSwitch: onSwitch)
        } label: {
            GTPanel {
                HStack(spacing: 10) {
                    Image(systemName: "rectangle.3.group")
                        .font(.system(size: 15))
                        .foregroundStyle(GT.accentLight)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Switch Mac")
                            .font(GT.sans(14, .medium))
                            .foregroundStyle(GT.text)
                        Text("Pick another machine on your tailnet")
                            .font(GT.sans(12))
                            .foregroundStyle(GT.textMuted)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(GT.textFaint)
                }
            }
        }
        .buttonStyle(.plain)
    }

    /// The never-die Stop hook, installed globally on the Mac. Without it, a
    /// session started from the phone in a repo that carries no hook answers
    /// once and then goes quiet. Never automatic: TerMinal does not write to
    /// ~/.claude unless asked, so this is the asking.
    private var hookPanel: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: hook?.installed == true ? "bolt.circle.fill" : "bolt.slash")
                        .font(.system(size: 15))
                        .foregroundStyle(hook?.installed == true ? GT.green : GT.textMuted)
                    Text(hookLabel)
                        .font(GT.sans(14))
                        .foregroundStyle(GT.textSoft)
                    Spacer()
                    if hookBusy {
                        ProgressView().tint(GT.accentLight)
                    } else if let hook {
                        Button(hook.installed ? "Remove" : "Install") {
                            Task { await setHook(install: !hook.installed) }
                        }
                        .font(GT.sans(13, .medium))
                        .foregroundStyle(hook.installed ? GT.red : GT.accentLight)
                        .buttonStyle(.plain)
                    }
                }
                Text(
                    "Keeps phone-started sessions alive between turns in every repo on "
                        + "that Mac, by registering a Stop hook in its ~/.claude/settings.json."
                )
                .font(GT.sans(12))
                .foregroundStyle(GT.textMuted)
                if let hook, !hook.commandExists {
                    Text("The Mac hasn't installed the tm plugin yet — open TerMinal there once.")
                        .font(GT.sans(12))
                        .foregroundStyle(GT.yellow)
                }
                if let hookMessage {
                    Divider().overlay(GT.border)
                    Text(hookMessage)
                        .font(GT.sans(12))
                        .foregroundStyle(GT.textSoft)
                }
            }
        }
    }

    private var hookLabel: String {
        guard let hook else { return "Checking…" }
        return hook.installed ? "Installed globally" : "Not installed"
    }

    private func refreshHook() async {
        let status = try? await client.globalHook()
        await MainActor.run { hook = status }
    }

    private func setHook(install: Bool) async {
        await MainActor.run { hookBusy = true }
        defer { Task { @MainActor in hookBusy = false } }
        do {
            let result = try await client.setGlobalHook(install: install)
            await MainActor.run { hookMessage = result.summary }
        } catch {
            await MainActor.run { hookMessage = error.localizedDescription }
        }
        await refreshHook()
    }

    /// Enough of the fingerprint to compare against the Mac, never the token.
    private var fingerprintPrefix: String {
        String(pairing.fp.prefix(12)) + "…"
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(GT.sans(12))
                .foregroundStyle(GT.textMuted)
                .frame(width: 78, alignment: .leading)
            Text(value)
                .font(GT.mono(12))
                .foregroundStyle(GT.textSoft)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    private var appLockPanel: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: lock.isEnabled ? "lock.fill" : "lock.open")
                        .font(.system(size: 15))
                        .foregroundStyle(lock.isEnabled ? GT.green : GT.textMuted)
                    Text(lock.isEnabled ? "Passcode on" : "No passcode")
                        .font(GT.sans(14))
                        .foregroundStyle(GT.textSoft)
                    Spacer()
                    Button(lock.isEnabled ? "Change" : "Set passcode") {
                        settingPasscode = true
                    }
                    .font(GT.sans(13, .medium))
                    .foregroundStyle(GT.accentLight)
                    .buttonStyle(.plain)
                }
                Text(
                    "Locks the app's contents on open and when you leave — "
                        + "notifications stay readable (unlike the iOS-level Face ID lock)."
                )
                .font(GT.sans(12))
                .foregroundStyle(GT.textMuted)
                if lock.isEnabled {
                    Divider().overlay(GT.border)
                    Toggle(isOn: Binding(
                        get: { lock.biometricsOptIn },
                        set: { lock.biometricsOptIn = $0 }
                    )) {
                        Text("Unlock with Face ID")
                            .font(GT.sans(13))
                            .foregroundStyle(GT.textSoft)
                    }
                    .tint(GT.accent)
                    Button("Turn off passcode") {
                        confirmingLockOff = true
                    }
                    .font(GT.sans(13))
                    .foregroundStyle(GT.red)
                    .buttonStyle(.plain)
                }
            }
        }
        .sheet(isPresented: $settingPasscode) {
            SetPasscodeSheet { code in
                if let code { lock.setPasscode(code) }
            }
        }
        .confirmationDialog(
            "Turn off the passcode?",
            isPresented: $confirmingLockOff,
            titleVisibility: .visible
        ) {
            Button("Turn off", role: .destructive) { lock.removePasscode() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var notificationsPanel: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: notifIcon)
                        .font(.system(size: 15))
                        .foregroundStyle(notifColor)
                    Text(notifLabel)
                        .font(GT.sans(14))
                        .foregroundStyle(GT.textSoft)
                    Spacer()
                }
                if notifStatus == .denied {
                    Text("Turn on notifications to get pinged when an agent needs you.")
                        .font(GT.sans(12))
                        .foregroundStyle(GT.textMuted)
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("Open iOS Settings").gtSecondaryButton()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var notifLabel: String {
        switch notifStatus {
        case .authorized, .provisional, .ephemeral: return "Notifications enabled"
        case .denied: return "Notifications off"
        case .notDetermined: return "Not requested yet"
        default: return "Checking…"
        }
    }

    private var notifIcon: String {
        switch notifStatus {
        case .authorized, .provisional, .ephemeral: return "bell.badge.fill"
        case .denied: return "bell.slash.fill"
        default: return "bell"
        }
    }

    private var notifColor: Color {
        switch notifStatus {
        case .authorized, .provisional, .ephemeral: return GT.green
        case .denied: return GT.yellow
        default: return GT.textMuted
        }
    }

    private func refreshNotifStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        await MainActor.run { notifStatus = settings.authorizationStatus }
    }

    private var aboutPanel: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: "app.badge")
                        .font(.system(size: 15))
                        .foregroundStyle(GT.accentLight)
                    Text("TerMinal Remote")
                        .font(GT.sans(14, .medium))
                        .foregroundStyle(GT.text)
                    Spacer()
                }
                Divider().overlay(GT.border)
                row("Version", appVersion)
            }
        }
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
