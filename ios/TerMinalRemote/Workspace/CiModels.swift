import Foundation

/// Native CI — mirror of src/main/ci.ts. Read-only run/job views for the phone;
/// the full log lives behind an "Open on <forge>" link.
struct CiRun: Codable, Identifiable, Hashable {
    let id: String
    let name: String  // workflow / pipeline name
    let status: String  // queued|in_progress|success|failed|canceled|skipped|pending
    let branch: String
    let shortSha: String
    let event: String
    let webUrl: String
    let createdAt: Double
    let updatedAt: Double
    let durationMs: Double?
}

struct CiStep: Codable, Hashable {
    let name: String
    let status: String
    let number: Int
}

struct CiJob: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let stage: String
    let status: String
    let webUrl: String
    let startedAt: Double?
    let finishedAt: Double?
    let durationMs: Double?
    let steps: [CiStep]?
}

enum Ci {
    /// Runs grouped by workflow name, each group's runs newest-first.
    static func grouped(_ runs: [CiRun]) -> [(name: String, runs: [CiRun])] {
        var order: [String] = []
        var map: [String: [CiRun]] = [:]
        for r in runs {
            if map[r.name] == nil { order.append(r.name) }
            map[r.name, default: []].append(r)
        }
        return order.map { (name: $0, runs: map[$0] ?? []) }
    }

    static func isRunning(_ status: String) -> Bool {
        status == "in_progress" || status == "queued" || status == "pending"
    }
}
