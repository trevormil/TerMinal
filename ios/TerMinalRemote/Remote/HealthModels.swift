import Foundation

/// One health check's latest status, as served by GET /v1/checks.
/// Mirrors the bridge's CheckStatus shape; metrics/meta values arrive as
/// heterogeneous JSON scalars and are flattened to strings for display.
struct CheckStatus: Decodable, Identifiable, Hashable {
    let kind: String
    /// "repo" | "global"
    let scope: String
    let repoLabel: String
    /// "ok" | "warn" | "fail"
    let status: String
    let summary: String
    let metrics: [String: String]?
    let detail: CheckDetail?
    /// Epoch millis.
    let updatedAt: Double
    let since: Double
    let lastTransition: CheckTransition?
    let history: [CheckHistoryPoint]?

    var id: String { "\(scope)/\(repoLabel)/\(kind)" }
    var isGlobal: Bool { scope == "global" }

    init(
        kind: String, scope: String, repoLabel: String, status: String, summary: String,
        metrics: [String: String]? = nil, detail: CheckDetail? = nil,
        updatedAt: Double, since: Double, lastTransition: CheckTransition? = nil,
        history: [CheckHistoryPoint]? = nil
    ) {
        self.kind = kind
        self.scope = scope
        self.repoLabel = repoLabel
        self.status = status
        self.summary = summary
        self.metrics = metrics
        self.detail = detail
        self.updatedAt = updatedAt
        self.since = since
        self.lastTransition = lastTransition
        self.history = history
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        scope = try c.decode(String.self, forKey: .scope)
        repoLabel = try c.decode(String.self, forKey: .repoLabel)
        status = try c.decode(String.self, forKey: .status)
        summary = try c.decode(String.self, forKey: .summary)
        metrics = try c.decodeIfPresent([String: JSONScalar].self, forKey: .metrics)?
            .compactMapValues(\.string)
        detail = try c.decodeIfPresent(CheckDetail.self, forKey: .detail)
        updatedAt = try c.decode(Double.self, forKey: .updatedAt)
        since = try c.decode(Double.self, forKey: .since)
        lastTransition = try c.decodeIfPresent(CheckTransition.self, forKey: .lastTransition)
        history = try c.decodeIfPresent([CheckHistoryPoint].self, forKey: .history)
    }

    private enum CodingKeys: String, CodingKey {
        case kind, scope, repoLabel, status, summary, metrics, detail
        case updatedAt, since, lastTransition, history
    }
}

struct CheckTransition: Decodable, Hashable {
    let from: String
    let to: String
    let at: Double
}

struct CheckHistoryPoint: Decodable, Hashable {
    let at: Double
    let status: String
}

struct CheckDetail: Decodable, Hashable {
    let sections: [CheckSection]
}

struct CheckSection: Decodable, Hashable {
    let title: String
    let items: [CheckItem]
}

struct CheckItem: Decodable, Hashable {
    let label: String
    let health: String
    let meta: [String: String]?

    init(label: String, health: String, meta: [String: String]? = nil) {
        self.label = label
        self.health = health
        self.meta = meta
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = try c.decode(String.self, forKey: .label)
        health = try c.decode(String.self, forKey: .health)
        meta = try c.decodeIfPresent([String: JSONScalar].self, forKey: .meta)?
            .compactMapValues(\.string)
    }

    private enum CodingKeys: String, CodingKey { case label, health, meta }
}

/// A heterogeneous JSON scalar flattened to a display string. Non-scalars
/// (arrays/objects) decode to nil and get dropped — the phone only displays
/// these values, so lossy is fine.
struct JSONScalar: Decodable {
    let string: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            string = s
        } else if let b = try? c.decode(Bool.self) {
            string = b ? "true" : "false"
        } else if let i = try? c.decode(Int.self) {
            string = String(i)
        } else if let d = try? c.decode(Double.self) {
            string = String(d)
        } else {
            string = nil
        }
    }
}

/// Worst status wins: fail > warn > ok. No checks reporting reads as healthy.
func overallStatus(_ checks: [CheckStatus]) -> String {
    if checks.contains(where: { $0.status == "fail" }) { return "fail" }
    if checks.contains(where: { $0.status == "warn" }) { return "warn" }
    return "ok"
}

/// A check whose reporter stopped running: last update more than 2h ago.
func isStale(_ check: CheckStatus, now: Date = Date()) -> Bool {
    now.timeIntervalSince1970 * 1000 - check.updatedAt > 2 * 3600 * 1000
}
