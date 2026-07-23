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
    @State private var active: ActiveSessionsViewModel
    @State private var push = PushRegistrar.shared
    @State private var deepLinked: RemoteSession?

    init(pairing: PairingPayload, onUnpair: @escaping () -> Void) {
        self.pairing = pairing
        self.onUnpair = onUnpair
        // One client shared across tabs so a single pinned session is reused.
        let c = BridgeClient(pairing: pairing)
        _client = State(initialValue: c)
        _active = State(initialValue: ActiveSessionsViewModel(client: c))
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
                InboxView(model: InboxViewModel(client: client))
            }
            .tabItem { Label("Inbox", systemImage: "tray") }
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
            // Only ask for notifications once there is a Mac to send the token
            // to — a permission prompt before pairing has nothing to offer.
            PushRegistrar.shared.client = client
            await PushRegistrar.shared.requestAuthorization()
            PushRegistrar.shared.resend()
        }
        .task {
            // Poll here, not inside the tab, so the Active badge stays live even
            // while you're on Workspaces or Inbox.
            while !Task.isCancelled {
                await active.refresh()
                try? await Task.sleep(for: .seconds(5))
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
        guard let (sessions, _) = try? await client.remote() else { return }
        if let match = sessions.first(where: { $0.id == id }) {
            await MainActor.run { deepLinked = match }
        }
    }
}
