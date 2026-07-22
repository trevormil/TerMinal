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
