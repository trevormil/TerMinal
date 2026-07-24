import Foundation

/// One monitor's config joined with its latest state, as served by
/// GET /v1/monitors. Mirrors the bridge's `Monitor & { state }` shape;
/// config/metrics/meta values arrive as heterogeneous JSON scalars and are
/// flattened to strings for display.
struct MonitorWithState: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    /// "http" | "tls-cert" | "tcp" | "dns" | "command"
    let type: String
    /// URL / host:port / hostname / command — the thing being checked.
    let target: String
    let intervalSec: Int
    let enabled: Bool
    let group: String?
    let notify: MonitorNotify
    let config: [String: String]
    /// nil until the daemon has probed this monitor at least once.
    let state: MonitorRuntimeState?

    init(
        id: String, name: String, type: String, target: String, intervalSec: Int,
        enabled: Bool, group: String? = nil, notify: MonitorNotify,
        config: [String: String] = [:], state: MonitorRuntimeState? = nil
    ) {
        self.id = id
        self.name = name
        self.type = type
        self.target = target
        self.intervalSec = intervalSec
        self.enabled = enabled
        self.group = group
        self.notify = notify
        self.config = config
        self.state = state
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        type = try c.decode(String.self, forKey: .type)
        target = try c.decode(String.self, forKey: .target)
        intervalSec = try c.decode(Int.self, forKey: .intervalSec)
        enabled = try c.decode(Bool.self, forKey: .enabled)
        group = try c.decodeIfPresent(String.self, forKey: .group)
        notify = try c.decode(MonitorNotify.self, forKey: .notify)
        config = (try c.decodeIfPresent([String: JSONScalar].self, forKey: .config)?
            .compactMapValues(\.string)) ?? [:]
        state = try c.decodeIfPresent(MonitorRuntimeState.self, forKey: .state)
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, type, target, intervalSec, enabled, group, notify, config, state
    }
}

struct MonitorNotify: Decodable, Hashable {
    /// Severity filed on failure, or "off".
    let onFailure: String
    let onRecovery: Bool
    let renotifyAfterSec: Int
    let dailyDigest: Bool
    let digestHour: Int
}

/// A monitor's latest probe result — everything the daemon last wrote.
struct MonitorRuntimeState: Decodable, Hashable {
    /// "ok" | "warn" | "fail"
    let status: String
    let summary: String
    let metrics: [String: String]?
    let detail: MonitorDetail?
    /// Epoch millis.
    let lastCheckedAt: Double
    let since: Double
    let lastTransition: MonitorTransition?
    let history: [MonitorHistoryPoint]?

    init(
        status: String, summary: String, metrics: [String: String]? = nil,
        detail: MonitorDetail? = nil, lastCheckedAt: Double, since: Double,
        lastTransition: MonitorTransition? = nil, history: [MonitorHistoryPoint]? = nil
    ) {
        self.status = status
        self.summary = summary
        self.metrics = metrics
        self.detail = detail
        self.lastCheckedAt = lastCheckedAt
        self.since = since
        self.lastTransition = lastTransition
        self.history = history
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(String.self, forKey: .status)
        summary = try c.decode(String.self, forKey: .summary)
        metrics = try c.decodeIfPresent([String: JSONScalar].self, forKey: .metrics)?
            .compactMapValues(\.string)
        detail = try c.decodeIfPresent(MonitorDetail.self, forKey: .detail)
        lastCheckedAt = try c.decode(Double.self, forKey: .lastCheckedAt)
        since = try c.decode(Double.self, forKey: .since)
        lastTransition = try c.decodeIfPresent(MonitorTransition.self, forKey: .lastTransition)
        history = try c.decodeIfPresent([MonitorHistoryPoint].self, forKey: .history)
    }

    private enum CodingKeys: String, CodingKey {
        case status, summary, metrics, detail, lastCheckedAt, since, lastTransition, history
    }
}

struct MonitorTransition: Decodable, Hashable {
    let from: String
    let to: String
    let at: Double
}

struct MonitorHistoryPoint: Decodable, Hashable {
    let at: Double
    let status: String
}

struct MonitorDetail: Decodable, Hashable {
    let sections: [MonitorSection]
}

struct MonitorSection: Decodable, Hashable {
    let title: String
    let items: [MonitorItem]
}

struct MonitorItem: Decodable, Hashable {
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

/// Worst status wins: fail > warn > ok. Monitors with no state yet don't drag
/// the verdict down, and an empty fleet reads as healthy.
func overallStatus(_ monitors: [MonitorWithState]) -> String {
    if monitors.contains(where: { $0.state?.status == "fail" }) { return "fail" }
    if monitors.contains(where: { $0.state?.status == "warn" }) { return "warn" }
    return "ok"
}

/// A monitor the daemon stopped probing: last check older than 3× its interval.
/// A monitor that has never reported (nil state) is not "stale" — it's pending.
func isStale(_ monitor: MonitorWithState, now: Date = Date()) -> Bool {
    guard let state = monitor.state else { return false }
    let staleMs = 3 * Double(monitor.intervalSec) * 1000
    return now.timeIntervalSince1970 * 1000 - state.lastCheckedAt > staleMs
}
