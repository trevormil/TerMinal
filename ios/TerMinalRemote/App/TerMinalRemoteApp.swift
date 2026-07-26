import SwiftUI

@main
struct TerMinalRemoteApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
    }
}

struct RootView: View {
    @State private var pairing: PairingPayload? = PairingStore.load()
    @State private var lock = AppLock.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            if let pairing {
                // Re-key on the token so unpair/re-pair rebuilds the client and its
                // pinned session rather than reusing stale credentials.
                PairedView(pairing: pairing, onUnpair: {
                    PairingStore.clear()
                    // Drop the push singleton's client too, so a later APNs token
                    // refresh can't POST with the revoked credentials.
                    PushRegistrar.shared.client = nil
                    self.pairing = nil
                })
                .id(pairing.t)
            } else {
                PairingView { payload in
                    PairingStore.save(payload)
                    self.pairing = payload
                }
            }
            // In-app passcode gate — contents locked, notifications untouched
            // (the iOS-level Face ID app lock hides notification previews;
            // this one doesn't).
            if lock.locked {
                LockView().transition(.opacity)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { lock.lockIfEnabled() }
        }
    }
}

/// The paired app: Active + Workspaces + Inbox tabs, plus a root-level deep-link
/// so a tapped notification opens its thread regardless of which tab/workspace is
/// showing (threads are nested under workspaces, so this can't live there).
private struct PairedView: View {
    let pairing: PairingPayload
    let onUnpair: () -> Void

    @State private var client: BridgeClient
    @State private var feed: RemoteFeed
    @State private var active: ActiveSessionsViewModel
    @State private var monitoring: MonitoringViewModel
    @State private var push = PushRegistrar.shared
    @State private var deepLinked: RemoteSession?
    /// Bound so a tapped notification can switch tabs — without this there was
    /// no way to land anywhere but the thread sheet.
    @State private var tab: Tab = .active
    /// Inbox item a notification named, so the Inbox can scroll to / open it.
    @State private var focusedHitlId: String?

    private enum Tab: Hashable { case active, workspaces, inbox, monitoring, settings }

    init(pairing: PairingPayload, onUnpair: @escaping () -> Void) {
        self.pairing = pairing
        self.onUnpair = onUnpair
        // One client shared across tabs so a single pinned session is reused,
        // and one feed so every tab reads the same poll.
        let c = BridgeClient(pairing: pairing)
        let f = RemoteFeed(client: c)
        _client = State(initialValue: c)
        _feed = State(initialValue: f)
        _active = State(initialValue: ActiveSessionsViewModel(feed: f))
        _monitoring = State(initialValue: MonitoringViewModel(client: c))
    }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                ActiveSessionsView(model: active)
            }
            .tabItem { Label("Active", systemImage: "bolt.horizontal") }
            .tag(Tab.active)
            .badge(active.awaitingCount)

            NavigationStack {
                WorkspacesView(model: WorkspacesViewModel(client: client))
            }
            .tabItem { Label("Workspaces", systemImage: "folder") }
            .tag(Tab.workspaces)

            NavigationStack {
                InboxView(model: InboxViewModel(feed: feed), focusedId: focusedHitlId)
            }
            .tabItem { Label("Inbox", systemImage: "tray") }
            .tag(Tab.inbox)

            NavigationStack {
                MonitoringView(model: monitoring)
            }
            .tabItem { Label("Monitoring", systemImage: "chart.line.uptrend.xyaxis") }
            .tag(Tab.monitoring)
            .badge(monitoring.failingCount)

            NavigationStack {
                SettingsView(pairing: pairing, onUnpair: onUnpair)
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
            .tag(Tab.settings)
        }
        .tint(GT.accentLight)
        // A tapped notification names a thread; open it over everything.
        .sheet(item: $deepLinked) { s in
            NavigationStack {
                RemoteThreadView(model: RemoteThreadViewModel(session: s, client: client))
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Close") { deepLinked = nil }
                        }
                    }
            }
            .preferredColorScheme(.dark)
        }
        .task {
            // A cold-launch notification tap sets pendingThreadKey before this
            // view exists, so .onChange never fires — consume it once here.
            if let route = push.pendingRoute {
                push.pendingRoute = nil
                await follow(route)
            }
        }
        .task {
            // Only ask for notifications once there is a Mac to send the token
            // to — a permission prompt before pairing has nothing to offer.
            PushRegistrar.shared.client = client
            await PushRegistrar.shared.requestAuthorization()
            PushRegistrar.shared.resend()
        }
        .task {
            // The app's ONE poll of /v1/remote: feeds the Active list, the
            // Inbox, and both badges from any tab. The interval stretches when
            // the Mac is unreachable (see RemoteFeed.pollInterval).
            while !Task.isCancelled {
                await feed.refresh()
                try? await Task.sleep(for: feed.pollInterval)
            }
        }
        .onChange(of: push.pendingRoute) { _, route in
            guard let route else { return }
            push.pendingRoute = nil
            Task { await follow(route) }
        }
    }

    /// Take a tapped notification somewhere. Never a no-op: an unresolvable
    /// thread falls back to the Inbox, which is what a completion hook or a
    /// block is about anyway. Previously an unknown key silently did nothing,
    /// so tapping a completion-hook alert opened the app to a blank state.
    private func follow(_ route: NotificationRoute) async {
        switch route {
        case .inbox(let hitlId):
            await MainActor.run {
                focusedHitlId = hitlId
                tab = .inbox
            }
        case .thread(let key):
            if await openThread(key) { return }
            // The alert named a session this device can't open — a desktop-only
            // session, or one that ended. Land on the Inbox rather than nowhere.
            await MainActor.run { tab = .inbox }
        }
    }

    /// Resolve a thread key to a live session and present it.
    /// Returns false when the id isn't a known registered session.
    @discardableResult
    private func openThread(_ id: String) async -> Bool {
        // The feed usually already knows the session; fall back to a fetch for
        // a notification that arrives ahead of the next poll tick.
        if let match = feed.sessions.first(where: { $0.id == id }) {
            await MainActor.run { deepLinked = match }
            return true
        }
        guard let (sessions, _) = try? await client.remote() else { return false }
        if let match = sessions.first(where: { $0.id == id }) {
            await MainActor.run { deepLinked = match }
            return true
        }
        return false
    }
}
