import Foundation

// Compact per-workspace shapes — mirror BridgeTicket/Pr/Run/Schedule in
// src/main/bridge/server.ts. Read-only in the app; the desktop is where you edit.

struct WsTicket: Codable, Identifiable, Hashable {
    let slug: String
    let id: Int
    let title: String
    let status: String
    let priority: String
    let type: String
    let hitl: Bool

    var isDone: Bool { status == "done" || status == "closed" }
}

struct WsPr: Codable, Identifiable, Hashable {
    let iid: Int
    let title: String
    let state: String
    let draft: Bool
    let author: String
    let url: String
    let labels: [String]
    let verdict: String?
    let score: Double?

    var id: Int { iid }
}

struct WsRun: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let engine: String
    let status: String
    let startedAt: Double
    let endedAt: Double?
    let branch: String
    /// Which log store holds this run — REQUIRED to fetch its log.
    let source: String
    let hostId: String?

    var isRunning: Bool { status == "running" || status == "working" }
    var failed: Bool { status == "error" || status == "failed" }
}

struct WsSchedule: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let describe: String
    let nextRun: Double?
    let enabled: Bool
}

// ---- drill-down detail (the full readable content behind a row) ----------

struct WsTicketDetail: Codable, Hashable {
    let slug: String
    let id: Int
    let title: String
    let status: String
    let priority: String
    let type: String
    let hitl: Bool
    /// Full markdown body.
    let body: String
    /// Acceptance criteria live OUTSIDE the body — render them separately.
    let acceptance: [String]?
    let prs: [String]?
}

struct WsFinding: Codable, Hashable, Identifiable {
    let severity: String?
    let title: String?
    let file: String?
    let line: Int?
    let text: String?
    var id: String { "\(file ?? "")-\(line ?? 0)-\(title ?? "")" }
}

struct WsPrDetail: Codable, Hashable {
    let iid: Int
    let title: String
    let state: String
    let draft: Bool
    let author: String
    let url: String
    let labels: [String]
    let verdict: String?
    let score: Double?
    let description: String
    let branch: String?
    let testStatus: String?
    let riskTier: String?
    /// The code-review artifact's markdown.
    let reviewNotes: String?
    let findings: [WsFinding]?
    let ci: String?
}

struct WsScheduleDetail: Codable, Hashable {
    let id: String
    let title: String
    let describe: String
    let nextRun: Double?
    let enabled: Bool
    let engine: String?
    let model: String?
    /// The agent prompt this schedule runs.
    let prompt: String
    let host: String?
    let runtime: String?
}

/// Big text (diff / log), plus whether the Mac cut it short for the wire.
struct WsText: Codable, Hashable {
    let text: String
    let truncated: Bool
}
