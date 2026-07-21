import SwiftUI

@main
struct TerMinalRemoteApp: App {
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
        NavigationStack {
            if let pairing {
                SessionListView(
                    model: SessionListViewModel(client: BridgeClient(pairing: pairing)),
                    onUnpair: {
                        PairingStore.clear()
                        self.pairing = nil
                    }
                )
                // Re-key on the token so unpair/re-pair rebuilds the client and
                // its pinned session rather than reusing stale credentials.
                .id(pairing.t)
            } else {
                PairingView { payload in
                    PairingStore.save(payload)
                    self.pairing = payload
                }
            }
        }
    }
}
