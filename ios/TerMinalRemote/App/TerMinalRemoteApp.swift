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

    var body: some View {
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
    @State private var health: HealthViewModel
    @State private var push = PushRegistrar.shared
    @State private var deepLinked: RemoteSession?

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
        _health = State(initialValue: HealthViewModel(client: c))
    }

    var body: some View {
        TabView {
            NavigationStack {
                ActiveSessionsView(model: active)
            }
            .tabItem { Label("Active", systemImage: "bolt.horizontal") }
            .badge(active.awaitingCount)

            NavigationStack {
                WorkspacesView(model: WorkspacesViewModel(client: client), onUnpair: onUnpair)
            }
            .tabItem { Label("Workspaces", systemImage: "folder") }

            NavigationStack {
                InboxView(model: InboxViewModel(feed: feed))
            }
            .tabItem { Label("Inbox", systemImage: "tray") }

            NavigationStack {
                HealthView(model: health)
            }
            .tabItem { Label("Health", systemImage: "waveform.path.ecg") }
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
            if let key = push.pendingThreadKey {
                push.pendingThreadKey = nil
                await openThread(key)
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
        .onChange(of: push.pendingThreadKey) { _, key in
            guard let key else { return }
            push.pendingThreadKey = nil
            Task { await openThread(key) }
        }
    }

    /// Resolve a tapped notification's thread key to a live session and present
    /// it. Best-effort: if the id isn't a known registered session, do nothing.
    private func openThread(_ id: String) async {
        // The feed usually already knows the session; fall back to a fetch for
        // a notification that arrives ahead of the next poll tick.
        if let match = feed.sessions.first(where: { $0.id == id }) {
            await MainActor.run { deepLinked = match }
            return
        }
        guard let (sessions, _) = try? await client.remote() else { return }
        if let match = sessions.first(where: { $0.id == id }) {
            await MainActor.run { deepLinked = match }
        }
    }
}
