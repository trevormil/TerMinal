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
            paired(pairing)
        } else {
            PairingView { payload in
                PairingStore.save(payload)
                self.pairing = payload
            }
        }
    }

    private func paired(_ pairing: PairingPayload) -> some View {
        let client = BridgeClient(pairing: pairing)
        let onUnpair = {
            PairingStore.clear()
            self.pairing = nil
        }
        return TabView {
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
        // Re-key on the token so unpair/re-pair rebuilds the client and its
        // pinned session rather than reusing stale credentials.
        .id(pairing.t)
        .task {
            // Only ask for notifications once there is a Mac to send the token
            // to — a permission prompt before pairing has nothing to offer.
            PushRegistrar.shared.client = client
            await PushRegistrar.shared.requestAuthorization()
            PushRegistrar.shared.resend()
        }
    }
}
