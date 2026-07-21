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
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            if let pairing {
                ChatListView(
                    model: ChatListViewModel(client: BridgeClient(pairing: pairing)),
                    onUnpair: {
                        PairingStore.clear()
                        self.pairing = nil
                    }
                )
                // Re-key on the token so unpair/re-pair rebuilds the client and
                // its pinned session rather than reusing stale credentials.
                .id(pairing.t)
                .task {
                    // Only ask for notifications once there is a Mac to send
                    // the token to — a permission prompt before pairing has
                    // nothing to offer.
                    PushRegistrar.shared.client = BridgeClient(pairing: pairing)
                    await PushRegistrar.shared.requestAuthorization()
                    PushRegistrar.shared.resend()
                }
            } else {
                PairingView { payload in
                    PairingStore.save(payload)
                    self.pairing = payload
                }
            }
        }
    }
}
