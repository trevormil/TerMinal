import Foundation

/// A session that registered itself with `terminal-cli remote register`.
/// Mirrors `BridgeRemoteSession` in src/main/bridge/server.ts.
struct RemoteSession: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let repo: String
    let branch: String
    let engine: String
    /// "working" | "awaiting" | "ended"
    let status: String
    /// What the agent is blocked on, when awaiting.
    let question: String?
    let lastSeenAt: Double
    let messages: Int

    var isAwaiting: Bool { status == "awaiting" }
    var hasEnded: Bool { status == "ended" }
}

/// One line of the conversation. The agent writes these; so do you.
struct RemoteMessage: Codable, Identifiable, Hashable {
    let at: Double
    let from: String
    let text: String
    /// Filenames served from /v1/remote/:id/image/:name.
    let images: [String]?

    var isAgent: Bool { from == "agent" }
    /// The log is append-only, so position is a stable identity.
    var id: String { "\(at)-\(from)-\(text.hashValue)-\(images?.count ?? 0)" }
}

/// A human-in-the-loop item — the cross-repo "something is blocked" queue.
struct HitlItem: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String?
    let action: String?
    let repo: String?
    let source: String
    let createdAt: Double
    /// 'push' notifies; 'normal' is inbox-only. Absent ⇒ treat as push.
    let severity: String?
    /// 'open' | 'resolved'. Absent ⇒ open.
    let status: String?
    /// When first seen; absent ⇒ unread.
    let readAt: Double?

    var isNormal: Bool { severity == "normal" }
    var isResolved: Bool { status == "resolved" }
    var isUnread: Bool { !isResolved && readAt == nil }

    /// A copy marked read now (struct is immutable, so rebuild it).
    func markedRead() -> HitlItem {
        HitlItem(
            id: id, title: title, detail: detail, action: action, repo: repo, source: source,
            createdAt: createdAt, severity: severity, status: status,
            readAt: Date().timeIntervalSince1970 * 1000)
    }

    /// A copy back on the unread pile — the email "keep this on my plate" move.
    func markedUnread() -> HitlItem {
        HitlItem(
            id: id, title: title, detail: detail, action: action, repo: repo, source: source,
            createdAt: createdAt, severity: severity, status: status, readAt: nil)
    }

    /// Preserve optimistic read-state across a server refresh.
    func markingReadIfIn(_ ids: Set<String>) -> HitlItem {
        (ids.contains(id) && readAt == nil) ? markedRead() : self
    }
}

/// A repo the phone may start a session in.
struct RepoOption: Codable, Identifiable, Hashable {
    let name: String
    let path: String
    /// Most recent activity in this repo, for recent-first ordering.
    let lastUsedAt: Double?
    /// The app-owned throwaway workspace — no repo attached.
    let scratch: Bool?

    var id: String { path }
    var isScratch: Bool { scratch == true }
}

