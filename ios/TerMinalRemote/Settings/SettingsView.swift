import SwiftUI
import UserNotifications

/// The Settings tab: what Mac this phone is paired with, notification state,
/// app version, and the one destructive action — unpair.
struct SettingsView: View {
    let pairing: PairingPayload
    let onUnpair: () -> Void

    @State private var notifStatus: UNAuthorizationStatus?
    @State private var confirmingUnpair = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    section("Paired Mac") { pairedMacPanel }
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
