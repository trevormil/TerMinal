import Foundation
import UserNotifications

/// The single source of truth for polled bridge state. One poll loop (owned by
/// PairedView) feeds every consumer — the Active tab, the Inbox, and the tab /
/// app-icon badges — so the same endpoint is never fetched by two loops at once.
@Observable
final class RemoteFeed {
    let client: BridgeClient
    private(set) var sessions: [RemoteSession] = []
    private(set) var hitl: [HitlItem] = []
    private(set) var error: String?
    var loading = true
    private var failures = 0

    init(client: BridgeClient) { self.client = client }

    /// After a few straight failures the Mac is genuinely unreachable (asleep,
    /// off-LAN) — stretch the poll so we stop hammering dead hosts, each tick
    /// of which health-probes every candidate address.
    var pollInterval: Duration { Self.interval(afterFailures: failures) }

    /// Stale = repeated failures; counts derived from `sessions` can't be
    /// trusted any more and shouldn't show as confident badges.
    var isStale: Bool { failures >= 3 }

    static func interval(afterFailures n: Int) -> Duration {
        n >= 3 ? .seconds(30) : .seconds(5)
    }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            let (s, h) = try await client.remote()
            sessions = s
            // Keep any optimistic read-state we applied so an item doesn't
            // flash unread mid-poll.
            let readLocally = Set(hitl.filter { $0.readAt != nil }.map(\.id))
            hitl = h.map { $0.markingReadIfIn(readLocally) }
            error = nil
            failures = 0
            syncBadge()
        } catch {
            self.error = error.localizedDescription
            failures += 1
        }
    }

    // ---- optimistic mutations (Inbox + Active rows) ---------------------

    @MainActor
    func removeSession(id: String) { sessions.removeAll { $0.id == id } }

    @MainActor
    func removeHitl(id: String) { hitl.removeAll { $0.id == id } }

    @MainActor
    func markHitlRead(ids: [String]) {
        hitl = hitl.map { ids.contains($0.id) ? $0.markedRead() : $0 }
        syncBadge()
    }

    /// The app icon badge tracks UNREAD, and clears as you read — iOS keeps it
    /// until the app resets it, which is why a stale "1" lingered.
    private func syncBadge() {
        UNUserNotificationCenter.current().setBadgeCount(hitl.filter(\.isUnread).count)
    }
}
