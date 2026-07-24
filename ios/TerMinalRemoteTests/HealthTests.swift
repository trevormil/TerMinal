import XCTest

@testable import TerMinalRemote

final class HealthTests: XCTestCase {
    private func check(_ kind: String, status: String, updatedAt: Double = 0) -> CheckStatus {
        CheckStatus(
            kind: kind, scope: "repo", repoLabel: "TerMinal", status: status,
            summary: "summary", updatedAt: updatedAt, since: 0)
    }

    // ---- decoding -------------------------------------------------------

    func testDecodesFullPayloadIncludingHeterogeneousMeta() throws {
        // Every field the bridge serves, with the meta/metrics values mixing
        // numbers, strings, and bools — the shapes the stringifier must absorb.
        let json = """
            {
              "checks": [
                {
                  "kind": "fleet-health",
                  "scope": "global",
                  "repoLabel": "",
                  "status": "warn",
                  "summary": "1 of 3 services degraded",
                  "metrics": { "services": 3, "latencyMs": 41.5, "allUp": false },
                  "detail": {
                    "sections": [
                      {
                        "title": "Services",
                        "items": [
                          {
                            "label": "api",
                            "health": "ok",
                            "meta": {
                              "url": "https://api.trevormil.com",
                              "code": 200,
                              "cached": true,
                              "ignored": ["not", "a", "scalar"]
                            }
                          },
                          { "label": "worker", "health": "fail" }
                        ]
                      }
                    ]
                  },
                  "updatedAt": 1753200000000,
                  "since": 1753100000000,
                  "lastTransition": { "from": "ok", "to": "warn", "at": 1753190000000 },
                  "history": [
                    { "at": 1753100000000, "status": "ok" },
                    { "at": 1753190000000, "status": "warn" }
                  ]
                }
              ]
            }
            """
        struct Envelope: Decodable { let checks: [CheckStatus] }
        let checks = try JSONDecoder().decode(Envelope.self, from: Data(json.utf8)).checks

        XCTAssertEqual(checks.count, 1)
        let c = checks[0]
        XCTAssertEqual(c.kind, "fleet-health")
        XCTAssertEqual(c.scope, "global")
        XCTAssertTrue(c.isGlobal)
        XCTAssertEqual(c.status, "warn")
        XCTAssertEqual(c.summary, "1 of 3 services degraded")
        // Scalars stringified; integers must not grow a ".0".
        XCTAssertEqual(
            c.metrics, ["services": "3", "latencyMs": "41.5", "allUp": "false"])
        XCTAssertEqual(c.updatedAt, 1_753_200_000_000)
        XCTAssertEqual(c.since, 1_753_100_000_000)
        XCTAssertEqual(c.lastTransition, CheckTransition(from: "ok", to: "warn", at: 1_753_190_000_000))
        XCTAssertEqual(c.history?.map(\.status), ["ok", "warn"])

        let sections = c.detail?.sections
        XCTAssertEqual(sections?.map(\.title), ["Services"])
        let items = sections?[0].items
        XCTAssertEqual(items?.map(\.label), ["api", "worker"])
        XCTAssertEqual(items?.map(\.health), ["ok", "fail"])
        // Bools/numbers stringified, the non-scalar array dropped.
        XCTAssertEqual(
            items?[0].meta,
            ["url": "https://api.trevormil.com", "code": "200", "cached": "true"])
        XCTAssertNil(items?[1].meta)
    }

    // ---- overallStatus --------------------------------------------------

    func testOverallStatusFailBeatsWarnBeatsOk() {
        XCTAssertEqual(
            overallStatus([
                check("a", status: "ok"), check("b", status: "warn"), check("c", status: "fail"),
            ]), "fail")
        XCTAssertEqual(
            overallStatus([check("a", status: "ok"), check("b", status: "warn")]), "warn")
        XCTAssertEqual(overallStatus([check("a", status: "ok")]), "ok")
    }

    func testOverallStatusEmptyIsOk() {
        XCTAssertEqual(overallStatus([]), "ok")
    }

    // ---- isStale --------------------------------------------------------

    func testIsStaleBoundaryAtTwoHours() {
        let now = Date(timeIntervalSince1970: 10_000_000)
        let nowMs = now.timeIntervalSince1970 * 1000
        let twoHoursMs: Double = 2 * 3600 * 1000
        // Exactly 2h old is still fresh; a millisecond past it is stale.
        XCTAssertFalse(isStale(check("a", status: "ok", updatedAt: nowMs - twoHoursMs), now: now))
        XCTAssertTrue(isStale(check("a", status: "ok", updatedAt: nowMs - twoHoursMs - 1), now: now))
        XCTAssertFalse(isStale(check("a", status: "ok", updatedAt: nowMs), now: now))
    }

    // ---- ranking --------------------------------------------------------

    func testRankPutsWorstFirstThenMostRecent() {
        let ranked = HealthViewModel.rank([
            check("ok-new", status: "ok", updatedAt: 9),
            check("fail-old", status: "fail", updatedAt: 1),
            check("warn", status: "warn", updatedAt: 5),
            check("fail-new", status: "fail", updatedAt: 8),
        ])
        XCTAssertEqual(ranked.map(\.kind), ["fail-new", "fail-old", "warn", "ok-new"])
    }
}
