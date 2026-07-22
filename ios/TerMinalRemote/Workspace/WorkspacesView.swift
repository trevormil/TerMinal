import SwiftUI

@Observable
final class WorkspacesViewModel {
    let client: BridgeClient
    private(set) var repos: [RepoOption] = []
    private(set) var error: String?
    var loading = true

    init(client: BridgeClient) { self.client = client }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            repos = try await client.workspaces()
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// Top level: pick a repo to open its cockpit. Each is its own workspace.
struct WorkspacesView: View {
    @State var model: WorkspacesViewModel
    let onUnpair: () -> Void

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    if model.repos.isEmpty && !model.loading {
                        GTPanel {
                            Text("No repos found on the Mac.")
                                .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    }
                    ForEach(model.repos) { repo in
                        NavigationLink(value: repo) { WorkspaceRow(repo: repo) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(14)
            }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
        }
        .navigationTitle("Workspaces")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationDestination(for: RepoOption.self) { repo in
            WorkspaceView(model: WorkspaceViewModel(client: model.client, repo: repo))
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Unpair this Mac", role: .destructive, action: onUnpair)
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(GT.textMuted)
                }
            }
        }
        .task { await model.refresh() }
    }
}

private struct WorkspaceRow: View {
    let repo: RepoOption
    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 14)).foregroundStyle(GT.accentLight)
                Text(repo.name).font(GT.sans(15, .medium)).foregroundStyle(GT.text)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(GT.textFaint)
            }
        }
    }
}
