import XCTest

@testable import TerMinalRemote

final class MonitoringTests: XCTestCase {
    private func monitor(
        _ id: String, status: String?, intervalSec: Int = 60,
        lastCheckedAt: Double = 0, group: String? = nil
    ) -> MonitorWithState {
        let notify = MonitorNotify(
            onFailure: "urgent", onRecovery: true, renotifyAfterSec: 0,
            dailyDigest: false, digestHour: 9)
        let state = status.map {
            MonitorRuntimeState(
                status: $0, summary: "summary", lastCheckedAt: lastCheckedAt, since: 0)
        }
        return MonitorWithState(
            id: id, name: id, type: "http", target: "https://x", intervalSec: intervalSec,
            enabled: true, group: group, notify: notify, state: state)
    }

    // ---- decoding -------------------------------------------------------

    func testDecodesFullPayloadIncludingHeterogeneousMetaAndNullState() throws {
        // Every field the bridge serves: heterogeneous config/metrics/meta mixing
        // numbers, strings, bools (plus a non-scalar to drop), and a monitor with
        // a null state to prove the phone tolerates never-probed monitors.
        let json = """
            {
              "monitors": [
                {
                  "id": "api-http",
                  "name": "API",
                  "type": "http",
                  "target": "https://api.example.com",
                  "intervalSec": 60,
                  "enabled": true,
                  "group": "Production",
                  "notify": {
                    "onFailure": "urgent",
                    "onRecovery": true,
                    "renotifyAfterSec": 3600,
                    "dailyDigest": true,
                    "digestHour": 8
                  },
                  "config": { "warnLatencyMs": 500, "expectStatus": "200", "followRedirects": true },
                  "state": {
                    "status": "warn",
                    "summary": "slow response",
                    "metrics": { "latencyMs": 812.5, "code": 200, "cached": false, "tags": ["x"] },
                    "detail": {
                      "sections": [
                        {
                          "title": "Endpoints",
                          "items": [
                            {
                              "label": "GET /health",
                              "health": "ok",
                              "meta": { "url": "https://api.example.com/health", "code": 200, "ok": true }
                            },
                            { "label": "GET /slow", "health": "warn" }
                          ]
                        }
                      ]
                    },
                    "lastCheckedAt": 1753200000000,
                    "since": 1753100000000,
                    "lastTransition": { "from": "ok", "to": "warn", "at": 1753190000000 },
                    "history": [
                      { "at": 1753100000000, "status": "ok" },
                      { "at": 1753190000000, "status": "warn" }
                    ]
                  }
                },
                {
                  "id": "cert",
                  "name": "TLS cert",
                  "type": "tls-cert",
                  "target": "example.com:443",
                  "intervalSec": 3600,
                  "enabled": true,
                  "notify": {
                    "onFailure": "off",
                    "onRecovery": false,
                    "renotifyAfterSec": 0,
                    "dailyDigest": false,
                    "digestHour": 9
                  },
                  "config": {},
                  "state": null
                }
              ]
            }
            """
        struct Envelope: Decodable { let monitors: [MonitorWithState] }
        let monitors = try JSONDecoder().decode(Envelope.self, from: Data(json.utf8)).monitors

        XCTAssertEqual(monitors.count, 2)

        let api = monitors[0]
        XCTAssertEqual(api.id, "api-http")
        XCTAssertEqual(api.name, "API")
        XCTAssertEqual(api.type, "http")
        XCTAssertEqual(api.target, "https://api.example.com")
        XCTAssertEqual(api.intervalSec, 60)
        XCTAssertTrue(api.enabled)
        XCTAssertEqual(api.group, "Production")
        XCTAssertEqual(api.notify, MonitorNotify(
            onFailure: "urgent", onRecovery: true, renotifyAfterSec: 3600,
            dailyDigest: true, digestHour: 8))
        // Scalars stringified; integer must not grow a ".0"; non-scalar dropped.
        XCTAssertEqual(
            api.config, ["warnLatencyMs": "500", "expectStatus": "200", "followRedirects": "true"])

        let state = try XCTUnwrap(api.state)
        XCTAssertEqual(state.status, "warn")
        XCTAssertEqual(state.summary, "slow response")
        XCTAssertEqual(state.metrics, ["latencyMs": "812.5", "code": "200", "cached": "false"])
        XCTAssertEqual(state.lastCheckedAt, 1_753_200_000_000)
        XCTAssertEqual(state.since, 1_753_100_000_000)
        XCTAssertEqual(
            state.lastTransition, MonitorTransition(from: "ok", to: "warn", at: 1_753_190_000_000))
        XCTAssertEqual(state.history?.map(\.status), ["ok", "warn"])

        let items = state.detail?.sections.first?.items
        XCTAssertEqual(items?.map(\.label), ["GET /health", "GET /slow"])
        XCTAssertEqual(items?.map(\.health), ["ok", "warn"])
        XCTAssertEqual(
            items?[0].meta, ["url": "https://api.example.com/health", "code": "200", "ok": "true"])
        XCTAssertNil(items?[1].meta)

        let cert = monitors[1]
        XCTAssertNil(cert.state)
        XCTAssertEqual(cert.config, [:])
        XCTAssertEqual(cert.notify.onFailure, "off")
    }

    // ---- overallStatus --------------------------------------------------

    func testOverallStatusFailBeatsWarnBeatsOk() {
        XCTAssertEqual(
            overallStatus([
                monitor("a", status: "ok"), monitor("b", status: "warn"),
                monitor("c", status: "fail"),
            ]), "fail")
        XCTAssertEqual(
            overallStatus([monitor("a", status: "ok"), monitor("b", status: "warn")]), "warn")
        XCTAssertEqual(overallStatus([monitor("a", status: "ok")]), "ok")
    }

    func testOverallStatusEmptyIsOk() {
        XCTAssertEqual(overallStatus([]), "ok")
    }

    func testOverallStatusIgnoresNullStateMonitors() {
        // A never-probed monitor must not drag the verdict below "ok".
        XCTAssertEqual(
            overallStatus([monitor("a", status: nil), monitor("b", status: "ok")]), "ok")
    }

    // ---- isStale --------------------------------------------------------

    func testIsStaleBoundaryAtThreeIntervals() {
        let now = Date(timeIntervalSince1970: 10_000_000)
        let nowMs = now.timeIntervalSince1970 * 1000
        // 60s interval → stale threshold is 3× = 180s.
        let staleMs: Double = 3 * 60 * 1000
        XCTAssertFalse(
            isStale(monitor("a", status: "ok", lastCheckedAt: nowMs - staleMs), now: now))
        XCTAssertTrue(
            isStale(monitor("a", status: "ok", lastCheckedAt: nowMs - staleMs - 1), now: now))
        XCTAssertFalse(isStale(monitor("a", status: "ok", lastCheckedAt: nowMs), now: now))
    }

    func testIsStaleFalseWhenNeverProbed() {
        XCTAssertFalse(isStale(monitor("a", status: nil), now: Date()))
    }

    // ---- grouping / ranking ---------------------------------------------

    func testGroupPutsWorstGroupAndWorstMonitorFirst() {
        let grouped = MonitoringViewModel.group([
            monitor("ok-a", status: "ok", lastCheckedAt: 9, group: "Staging"),
            monitor("fail-old", status: "fail", lastCheckedAt: 1, group: "Production"),
            monitor("warn-b", status: "warn", lastCheckedAt: 5, group: "Staging"),
            monitor("fail-new", status: "fail", lastCheckedAt: 8, group: "Production"),
        ])
        // Production has the failures → first; worst-then-most-recent within it.
        XCTAssertEqual(grouped.map(\.group), ["Production", "Staging"])
        XCTAssertEqual(grouped[0].monitors.map(\.id), ["fail-new", "fail-old"])
        XCTAssertEqual(grouped[1].monitors.map(\.id), ["warn-b", "ok-a"])
    }
}
