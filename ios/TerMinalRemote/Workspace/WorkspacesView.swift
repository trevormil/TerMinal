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
    @State private var pins: [String] = PinnedReposStore.all()

    // The Mac already returns repos recency-first; the phone layers its own
    // pins on top and splits "touched recently" from the long tail.
    private var scratch: [RepoOption] { model.repos.filter(\.isScratch) }
    private var real: [RepoOption] { model.repos.filter { !$0.isScratch } }
    private var pinnedRepos: [RepoOption] { real.filter { pins.contains($0.path) } }
    private var recentRepos: [RepoOption] {
        real.filter { !pins.contains($0.path) && ($0.lastUsedAt ?? 0) > 0 }.prefix(8).map { $0 }
    }
    private var otherRepos: [RepoOption] {
        let shown = Set(pinnedRepos.map(\.path) + recentRepos.map(\.path))
        return real.filter { !shown.contains($0.path) }.sorted { $0.name < $1.name }
    }

    @ViewBuilder
    private func group(_ title: String, _ repos: [RepoOption]) -> some View {
        if !repos.isEmpty {
            if !title.isEmpty {
                Text(title.uppercased())
                    .font(GT.sans(10, .semibold))
                    .tracking(0.8)
                    .foregroundStyle(GT.textFaint)
                    .padding(.top, 4)
            }
            ForEach(repos) { repo in
                NavigationLink(value: repo) {
                    WorkspaceRow(repo: repo, pinned: pins.contains(repo.path))
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button(
                        pins.contains(repo.path) ? "Unpin" : "Pin",
                        systemImage: pins.contains(repo.path) ? "pin.slash" : "pin"
                    ) {
                        PinnedReposStore.toggle(repo.path)
                        pins = PinnedReposStore.all()
                    }
                }
            }
        }
    }

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

                    // Throwaway workspace first — one tap to a repo-less session.
                    ForEach(scratch) { repo in
                        NavigationLink(value: repo) { WorkspaceRow(repo: repo, pinned: false) }
                            .buttonStyle(.plain)
                    }
                    group("Pinned", pinnedRepos)
                    group("Recent", recentRepos)
                    group(pinnedRepos.isEmpty && recentRepos.isEmpty ? "" : "All", otherRepos)
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
    let pinned: Bool

    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                Image(systemName: repo.isScratch ? "tray.full" : "folder.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(repo.isScratch ? GT.accent2 : GT.accentLight)
                VStack(alignment: .leading, spacing: 2) {
                    Text(repo.name).font(GT.sans(15, .medium)).foregroundStyle(GT.text)
                    if repo.isScratch {
                        Text("Throwaway session, no repo attached")
                            .font(GT.sans(11)).foregroundStyle(GT.textFaint)
                    } else if let used = repo.lastUsedAt, used > 0 {
                        Text(relativeTime(used)).font(GT.mono(10)).foregroundStyle(GT.textFaint)
                    }
                }
                Spacer()
                if pinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 10)).foregroundStyle(GT.accentLight)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(GT.textFaint)
            }
        }
    }
}
