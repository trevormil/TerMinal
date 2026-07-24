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

    /// Pure so it's unit-testable without a bridge: drop ended sessions, then
    /// awaiting (blocked on you) > working > idle (parked), recency within a tier.
    static func rank(_ sessions: [RemoteSession]) -> [RemoteSession] {
        func tier(_ s: RemoteSession) -> Int { s.isAwaiting ? 0 : s.isIdle ? 2 : 1 }
        return sessions
            .filter { !$0.hasEnded }
            .sorted { a, b in
                if tier(a) != tier(b) { return tier(a) < tier(b) }
                return a.lastSeenAt > b.lastSeenAt
            }
    }

    static func awaitingCount(_ sessions: [RemoteSession], stale: Bool) -> Int {
        stale ? 0 : rank(sessions).filter(\.isAwaiting).count
    }

    @MainActor
    func refresh() async { await feed.refresh() }

    /// Ask the agent to finish up — the session stays listed, marked ended.
    @MainActor
    func terminate(_ s: RemoteSession) async {
        try? await feed.client.endSession(id: s.id)
        await feed.refresh()
    }

    /// Unregister from the phone entirely (the Mac session keeps running).
    @MainActor
    func unregister(_ s: RemoteSession) async {
        feed.removeSession(id: s.id)
        try? await feed.client.deleteSession(id: s.id)
        await feed.refresh()
    }
}

/// Global, cross-workspace: every live session at a glance so you don't have to
/// tab through workspaces to see what your agents are doing. Awaiting ones — the
/// agents waiting on an answer — sort to the top; tap one to jump into its thread.
struct ActiveSessionsView: View {
    @State var model: ActiveSessionsViewModel

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            // A real List (not a LazyVStack) so rows get native swipe actions.
            List {
                if let error = model.error {
                    GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                        .plainRow()
                }
                if model.active.isEmpty && !model.loading {
                    GTPanel {
                        Text(
                            "No live sessions. Start one from a workspace, or run /remote-terminal on your Mac."
                        )
                        .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                    }
                    .plainRow()
                }
                ForEach(model.active) { s in
                    // Chevron lives INSIDE the card (SessionRow draws it); the
                    // native List accessory is suppressed by hiding the link.
                    SessionRow(session: s)
                        .background(NavigationLink(value: s) { EmptyView() }.opacity(0))
                        .plainRow()
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task { await model.unregister(s) }
                            } label: {
                                Label("Unregister", systemImage: "iphone.slash")
                            }
                            if !s.hasEnded {
                                Button {
                                    Task { await model.terminate(s) }
                                } label: {
                                    Label("End", systemImage: "stop.circle")
                                }
                                .tint(.orange)
                            }
                        }
                        .contextMenu {
                            if !s.hasEnded {
                                Button("End session", systemImage: "stop.circle") {
                                    Task { await model.terminate(s) }
                                }
                            }
                            Button("Unregister from phone", systemImage: "iphone.slash", role: .destructive) {
                                Task { await model.unregister(s) }
                            }
                        }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
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
