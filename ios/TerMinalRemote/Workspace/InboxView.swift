import SwiftUI

@Observable
final class InboxViewModel {
    let client: BridgeClient
    private(set) var hitl: [HitlItem] = []
    private(set) var error: String?
    var loading = true

    init(client: BridgeClient) { self.client = client }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            let (_, hitl) = try await client.remote()
            self.hitl = hitl
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    @MainActor
    func resolve(_ item: HitlItem, approved: Bool) async {
        hitl.removeAll { $0.id == item.id }
        try? await client.resolveHitl(id: item.id, resolved: approved)
        await refresh()
    }
}

/// Global, cross-workspace: everything blocked and waiting on you.
struct InboxView: View {
    @State var model: InboxViewModel

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    if model.hitl.isEmpty && !model.loading {
                        GTPanel {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Inbox zero")
                                    .font(GT.sans(14, .medium)).foregroundStyle(GT.text)
                                Text("Nothing is blocked. Agents that need you show up here.")
                                    .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                            }
                        }
                    }
                    ForEach(model.hitl) { item in
                        HitlCard(item: item) { approved in
                            Task { await model.resolve(item, approved: approved) }
                        }
                    }
                }
                .padding(14)
            }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
        }
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}
