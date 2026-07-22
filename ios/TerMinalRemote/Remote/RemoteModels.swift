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

    var isAgent: Bool { from == "agent" }
    /// The log is append-only, so position is a stable identity.
    var id: String { "\(at)-\(from)-\(text.hashValue)" }
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
}
