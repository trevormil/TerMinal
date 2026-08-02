import Foundation

/// A session that registered itself with `terminal-cli remote register`.
/// Mirrors `BridgeRemoteSession` in src/main/bridge/server.ts.
struct RemoteSession: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let repo: String
    let branch: String
    let engine: String
    /// "working" | "awaiting" | "idle" (parked between turns) | "ended"
    let status: String
    /// What the agent is blocked on, when awaiting.
    let question: String?
    let lastSeenAt: Double
    let messages: Int

    var isAwaiting: Bool { status == "awaiting" }
    var isIdle: Bool { status == "idle" }
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
    var status: String?
    /// When first seen; absent ⇒ unread.
    var readAt: Double?
    /// Free-form, named by the caller that filed the item. NOT an enum —
    /// see InboxCategories and src/shared/inbox-categories.ts. Absent for most
    /// existing items, which is a real state, not a gap.
    let category: String?

    var isNormal: Bool { severity == "normal" }
    var isResolved: Bool { status == "resolved" }
    // One axis: read = seen (readAt) OR legacy-resolved (already dealt with).
    // Mirrors src/main/hitl.ts isHitlRead.
    var isUnread: Bool { readAt == nil && status != "resolved" }

    // The copies below mutate a `var copy = self` rather than calling the
    // memberwise init field by field. The old form silently dropped any field
    // added after it was written — adding `category` would have made the
    // optimistic mark-read wipe an item's category until the next refresh put
    // it back. A copy that enumerates fields is a bug waiting for the next one.

    /// A copy marked read now.
    func markedRead() -> HitlItem {
        var copy = self
        copy.readAt = Date().timeIntervalSince1970 * 1000
        return copy
    }

    /// A copy back on the unread pile — the email "keep this on my plate" move.
    /// Clears BOTH readAt and a legacy resolved status, or a once-resolved item
    /// could never return to unread. Mirrors markHitlRead(read:false).
    func markedUnread() -> HitlItem {
        var copy = self
        copy.status = "open"
        copy.readAt = nil
        return copy
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
    /// 'github' | 'gitlab' when CI is configured — gates the CI tab.
    let forge: String?

    var id: String { path }
    var isScratch: Bool { scratch == true }
    var hasCi: Bool { forge != nil }
}

