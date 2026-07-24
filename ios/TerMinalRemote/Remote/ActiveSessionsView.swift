import SwiftUI

@Observable
final class ActiveSessionsViewModel {
    let feed: RemoteFeed
    var client: BridgeClient { feed.client }
    var error: String? { feed.error }
    var loading: Bool { feed.loading }

    init(feed: RemoteFeed) { self.feed = feed }

    /// Everything still live, anywhere — the whole point of this tab is the
    /// cross-workspace glance you'd otherwise reconstruct by opening each repo.
    var active: [RemoteSession] { Self.rank(feed.sessions) }

    /// Agents blocked on you, for the tab badge. Zero once the feed goes stale
    /// so a dead bridge doesn't keep showing a confident count.
    var awaitingCount: Int { Self.awaitingCount(feed.sessions, stale: feed.isStale) }

    /// Pure so it's unit-testable without a bridge: drop ended sessions, float
    /// the ones awaiting you to the top, then most-recently-seen first.
    static func rank(_ sessions: [RemoteSession]) -> [RemoteSession] {
        sessions
            .filter { !$0.hasEnded }
            .sorted { a, b in
                if a.isAwaiting != b.isAwaiting { return a.isAwaiting }
                return a.lastSeenAt > b.lastSeenAt
            }
    }

    static func awaitingCount(_ sessions: [RemoteSession], stale: Bool) -> Int {
        stale ? 0 : rank(sessions).filter(\.isAwaiting).count
    }

    @MainActor
    func refresh() async { await feed.refresh() }
}

/// Global, cross-workspace: every live session at a glance so you don't have to
/// tab through workspaces to see what your agents are doing. Awaiting ones — the
/// agents waiting on an answer — sort to the top; tap one to jump into its thread.
struct ActiveSessionsView: View {
    @State var model: ActiveSessionsViewModel

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                LazyVStack(spacing: 10) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    if model.active.isEmpty && !model.loading {
                        GTPanel {
                            Text(
                                "No live sessions. Start one from a workspace, or run /remote-terminal on your Mac."
                            )
                            .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    }
                    ForEach(model.active) { s in
                        NavigationLink(value: s) { SessionRow(session: s) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(14)
            }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
        }
        .navigationTitle("Active")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationDestination(for: RemoteSession.self) { s in
            RemoteThreadView(model: RemoteThreadViewModel(session: s, client: model.client))
        }
    }
}
