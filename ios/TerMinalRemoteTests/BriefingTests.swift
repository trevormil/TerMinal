import XCTest

@testable import TerMinalRemote

/// Contract test between `src/main/briefings.ts` and the Swift models. The JSON
/// below is a verbatim `GET /v1/briefing` envelope — if the TypeScript shape
/// changes, this is what catches it, since nothing in CI compiles Swift.
final class BriefingTests: XCTestCase {
    private let json = """
        {
          "briefing": {
            "date": "2026-07-31",
            "path": "/Users/x/.config/TerMinal/briefings/2026-07-31.md",
            "generated": "2026-07-31T08:00:00Z",
            "status": "ok",
            "summary": "Two PRs opened overnight and one idea proposed.",
            "items": [
              {
                "id": "pr-1",
                "kind": "pr",
                "title": "Backfill 6 tests in ticket-provider",
                "agent": "coverage",
                "repo": "TerMinal",
                "link": "https://github.com/o/r/pull/201",
                "nav": "mrs",
                "detail": "Coverage rose 72.1% to 74.8%."
              },
              {
                "id": "idea-1",
                "kind": "idea",
                "title": "Cache invalidation test for the workspace daemon",
                "agent": "ticket-ideas",
                "repo": "TerMinal",
                "ledgerKey": "workspace-daemon-cache-invalidation",
                "link": "ticket:0130",
                "verdict": "dismissed"
              },
              {
                "id": "run-1",
                "kind": "run",
                "title": "deps-quality failed on beacon",
                "repo": "beacon"
              }
            ]
          }
        }
        """

    private struct Envelope: Decodable { let briefing: Briefing? }

    private func decode() throws -> Briefing {
        let b = try JSONDecoder().decode(Envelope.self, from: Data(json.utf8)).briefing
        return try XCTUnwrap(b)
    }

    func testDecodesTheBridgeEnvelope() throws {
        let b = try decode()
        XCTAssertEqual(b.date, "2026-07-31")
        XCTAssertEqual(b.status, "ok")
        XCTAssertEqual(b.summary, "Two PRs opened overnight and one idea proposed.")
        XCTAssertEqual(b.items.count, 3)

        let pr = b.items[0]
        XCTAssertEqual(pr.kind, "pr")
        XCTAssertEqual(pr.agent, "coverage")
        XCTAssertEqual(pr.detail, "Coverage rose 72.1% to 74.8%.")
        XCTAssertNil(pr.verdict)

        XCTAssertEqual(b.items[1].ledgerKey, "workspace-daemon-cache-invalidation")
        XCTAssertEqual(b.items[1].verdict, "dismissed")
    }

    /// An item written by an agent can omit almost every field. Decoding must
    /// degrade to a sparse row, never fail and blank the whole section.
    func testAnItemWithOnlyRequiredFieldsStillDecodes() throws {
        let b = try decode()
        let run = b.items[2]
        XCTAssertEqual(run.title, "deps-quality failed on beacon")
        XCTAssertNil(run.agent)
        XCTAssertNil(run.link)
        XCTAssertNil(run.ledgerKey)
    }

    func testNullBriefingIsNotAnError() throws {
        let b = try JSONDecoder().decode(
            Envelope.self, from: Data(#"{"briefing": null}"#.utf8)
        ).briefing
        XCTAssertNil(b)
    }

    // MARK: - externalURL

    func testOnlyHttpLinksBecomeAnExternalURL() throws {
        let b = try decode()
        XCTAssertEqual(b.items[0].externalURL?.absoluteString, "https://github.com/o/r/pull/201")
        // `ticket:` is a desktop tab deep-link with no phone equivalent — it
        // must not be handed to Safari as a bogus URL.
        XCTAssertNil(b.items[1].externalURL)
        XCTAssertNil(b.items[2].externalURL)
    }

    // MARK: - ordering

    func testUnreviewedItemsSortAboveReviewedOnes() throws {
        let b = try decode()
        let sorted = sortedBriefingItems(b.items)
        XCTAssertEqual(sorted.map(\.id), ["run-1", "pr-1", "idea-1"])
        // run-1 is a blocker so it outranks the PR; idea-1 is already dismissed
        // so it sinks below both regardless of its kind rank.
        XCTAssertEqual(sorted.last?.id, "idea-1")
    }

    func testBlockersOutrankPrsWhichOutrankProposals() {
        XCTAssertLessThan(BriefingKind.rank("hitl"), BriefingKind.rank("pr"))
        XCTAssertLessThan(BriefingKind.rank("run"), BriefingKind.rank("pr"))
        XCTAssertLessThan(BriefingKind.rank("pr"), BriefingKind.rank("idea"))
        XCTAssertLessThan(BriefingKind.rank("idea"), BriefingKind.rank("report"))
    }

    func testSortIsStableForEqualRanks() {
        let items = ["pr-2", "pr-1", "pr-3"].map {
            BriefingItem(
                id: $0, kind: "pr", title: "t", detail: nil, repo: nil, agent: nil,
                ledgerKey: nil, link: nil, verdict: nil)
        }
        XCTAssertEqual(sortedBriefingItems(items).map(\.id), ["pr-1", "pr-2", "pr-3"])
    }

    func testEveryKnownKindHasItsOwnGlyph() {
        // A kind falling through to the default circle is invisible in review;
        // pin the ones the contract defines.
        for kind in ["pr", "ticket", "idea", "hitl", "run", "report", "lesson"] {
            XCTAssertNotEqual(
                BriefingKind.glyph(kind).0, "circle", "\(kind) fell through to the default glyph")
        }
        XCTAssertEqual(BriefingKind.glyph("note").0, "circle")
    }
}
