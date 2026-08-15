import SwiftUI

@Observable
final class FleetViewModel {
    let client: BridgeClient
    /// Bridge port to reach the picked Mac on — the paired Mac's, since every
    /// TerMinal install serves the bridge on the same configured port.
    let port: Int

    private(set) var machines: [TailnetMachine] = []
    /// Set when Tailscale itself is stopped/absent on the paired Mac — a state
    /// to show, not an error to retry.
    private(set) var unavailable: String?
    private(set) var error: String?
    var loading = true
    /// dnsName of the machine currently being switched to.
    var switching: String?

    init(client: BridgeClient, port: Int) {
        self.client = client
        self.port = port
    }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            switch try await client.tailnet() {
            case .machines(let list):
                machines = list
                unavailable = nil
            case .unavailable(let reason):
                machines = []
                unavailable = reason
            }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    /// Pair with another Mac on the tailnet and hand back its payload. The new
    /// Mac issues its OWN token and certificate — a fleet switch is a fresh
    /// tailnet pairing with the machine you picked, not the old token replayed
    /// somewhere else.
    @MainActor
    func select(_ machine: TailnetMachine) async -> PairingPayload? {
        guard !machine.isSelf, !machine.dnsName.isEmpty else { return nil }
        switching = machine.dnsName
        defer { switching = nil }
        do {
            let payload = try await TailscalePairing.pair(host: machine.dnsName, port: port)
            PairingStore.save(payload)
            RecentHostsStore.remember(
                RecentHost(host: machine.dnsName, port: port, name: payload.n))
            error = nil
            return payload
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }
}

/// The fleet picker: every Mac on the tailnet, online first, with the one this
/// phone drives marked. Tapping another pairs with it and switches — the choice
/// persists because pairing IS the persisted state (Keychain), so a relaunch
/// comes back on the Mac you picked.
struct FleetView: View {
    @State var model: FleetViewModel
    /// Handed the new pairing once a switch succeeds.
    var onSwitch: (PairingPayload) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var pending: TailnetMachine?

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    if let unavailable = model.unavailable {
                        GTPanel {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 8) {
                                    Image(systemName: "network.slash")
                                        .foregroundStyle(GT.yellow)
                                    Text("No tailnet")
                                        .font(GT.sans(14, .medium)).foregroundStyle(GT.text)
                                }
                                Text(unavailable)
                                    .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                                Text("Start Tailscale on that Mac, then pull to refresh.")
                                    .font(GT.sans(12)).foregroundStyle(GT.textFaint)
                            }
                        }
                    }
                    if model.machines.isEmpty && model.unavailable == nil && !model.loading {
                        GTPanel {
                            Text("No machines on this tailnet yet.")
                                .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    }
                    ForEach(model.machines) { machine in
                        Button {
                            guard !machine.isSelf else { return }
                            pending = machine
                        } label: {
                            MachineRow(machine: machine, switching: model.switching == machine.dnsName)
                        }
                        .buttonStyle(.plain)
                        .disabled(machine.isSelf || model.switching != nil)
                    }
                    Text(
                        "Switching pairs this phone with the Mac you pick, over Tailscale. "
                            + "Both machines must be signed in to the same Tailscale account, "
                            + "and TerMinal's bridge must be on there too."
                    )
                    .font(GT.sans(11))
                    .foregroundStyle(GT.textFaint)
                    .padding(.top, 4)
                }
                .padding(14)
            }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
        }
        .navigationTitle("Fleet")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .confirmationDialog(
            pending.map { "Switch to \($0.name)? This phone will drive that Mac instead." } ?? "",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            titleVisibility: .visible
        ) {
            Button("Switch") {
                guard let machine = pending else { return }
                pending = nil
                Task {
                    if let payload = await model.select(machine) {
                        onSwitch(payload)
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) { pending = nil }
        }
        .task { await model.refresh() }
    }
}

private struct MachineRow: View {
    let machine: TailnetMachine
    let switching: Bool

    var body: some View {
        GTPanel {
            HStack(spacing: 11) {
                Image(systemName: symbol)
                    .font(.system(size: 15))
                    .foregroundStyle(machine.online ? GT.accentLight : GT.textFaint)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 3) {
                    Text(machine.name)
                        .font(GT.sans(14, .medium))
                        .foregroundStyle(machine.online ? GT.text : GT.textMuted)
                    Text(machine.dnsName)
                        .font(GT.mono(10))
                        .foregroundStyle(GT.textFaint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 4)
                if switching {
                    ProgressView().tint(GT.accentLight)
                } else if machine.isSelf {
                    Text("Current")
                        .font(GT.sans(10, .semibold))
                        .foregroundStyle(GT.green)
                } else {
                    Text(machine.online ? "Online" : "Offline")
                        .font(GT.sans(10, .semibold))
                        .foregroundStyle(machine.online ? GT.green : GT.textFaint)
                }
            }
        }
        .opacity(machine.online || machine.isSelf ? 1 : 0.65)
    }
}

/// Rough OS → glyph. Anything unrecognised still gets a sensible box.
private extension MachineRow {
    var symbol: String {
        switch machine.os.lowercased() {
        case "macos": return "desktopcomputer"
        case "ios", "ipados": return "iphone"
        case "android": return "candybarphone"
        case "windows": return "pc"
        case "linux": return "server.rack"
        default: return "shippingbox"
        }
    }
}
