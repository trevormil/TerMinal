import SwiftUI

@Observable
final class SessionListViewModel {
    private(set) var sessions: [BridgeSession] = []
    private(set) var error: String?
    /// True only until the first attempt resolves. Re-showing the spinner on
    /// every poll would flicker the list every few seconds — and an indefinite
    /// animation also stops the app from ever going idle.
    private(set) var loading = true

    let client: BridgeClient

    init(client: BridgeClient) {
        self.client = client
    }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            sessions = try await client.sessions()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The live terminals on the paired Mac.
struct SessionListView: View {
    @State var model: SessionListViewModel
    let onUnpair: () -> Void

    var body: some View {
        List {
            if let error = model.error {
                Section {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(.orange)
                }
            }
            Section {
                ForEach(model.sessions) { session in
                    NavigationLink {
                        TerminalScreen(
                            model: SessionViewModel(session: session, client: model.client))
                    } label: {
                        row(session)
                    }
                }
            } header: {
                Text(model.sessions.isEmpty ? "" : "Live sessions")
            } footer: {
                if model.sessions.isEmpty && model.error == nil && !model.loading {
                    Text("No sessions open. Start one in TerMinal on your Mac.")
                        .font(.system(size: 12))
                }
            }
        }
        .navigationTitle(model.client.pairing.n)
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if model.loading { ProgressView() } }
        .refreshable { await model.refresh() }
        .task {
            // Poll: the list is small and the Mac has no way to push to a phone
            // that hasn't opened a session stream.
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(4))
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Unpair this Mac", role: .destructive, action: onUnpair)
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    private func row(_ session: BridgeSession) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(session.status == "working" ? .green : .gray)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.name)
                    .font(.system(size: 15, weight: .medium))
                HStack(spacing: 6) {
                    if !session.repo.isEmpty {
                        Text(session.repo)
                    }
                    if !session.branch.isEmpty {
                        Text("· \(session.branch)")
                    }
                    Text("· \(session.cols)×\(session.rows)")
                }
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}
