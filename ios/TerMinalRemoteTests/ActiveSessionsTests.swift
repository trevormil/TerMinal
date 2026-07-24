import XCTest

@testable import TerMinalRemote

/// The Active tab's ranking is pure, so it's tested directly — no bridge needed.
final class ActiveSessionsTests: XCTestCase {
    private func session(
        _ id: String, status: String, lastSeenAt: Double
    ) -> RemoteSession {
        RemoteSession(
            id: id, title: id, repo: "repo", branch: "main", engine: "codex",
            status: status, question: status == "awaiting" ? "?" : nil,
            lastSeenAt: lastSeenAt, messages: 0)
    }

    func testDropsEndedSessions() {
        let ranked = ActiveSessionsViewModel.rank([
            session("a", status: "working", lastSeenAt: 1),
            session("b", status: "ended", lastSeenAt: 2),
        ])
        XCTAssertEqual(ranked.map(\.id), ["a"])
    }

    func testAwaitingSortsAboveWorkingRegardlessOfRecency() {
        // The working one is more recent, but the awaiting one still leads:
        // an agent blocked on you outranks a busy one.
        let ranked = ActiveSessionsViewModel.rank([
            session("working", status: "working", lastSeenAt: 100),
            session("awaiting", status: "awaiting", lastSeenAt: 1),
        ])
        XCTAssertEqual(ranked.map(\.id), ["awaiting", "working"])
    }

    func testMostRecentlySeenFirstWithinSameStatus() {
        let ranked = ActiveSessionsViewModel.rank([
            session("old", status: "working", lastSeenAt: 1),
            session("new", status: "working", lastSeenAt: 9),
            session("mid", status: "working", lastSeenAt: 5),
        ])
        XCTAssertEqual(ranked.map(\.id), ["new", "mid", "old"])
    }

    func testIdleParksBelowWorkingAboveNothing() {
        // A parked (idle) session matters less than one actively working, even
        // when it's more recent.
        let ranked = ActiveSessionsViewModel.rank([
            session("idle", status: "idle", lastSeenAt: 100),
            session("working", status: "working", lastSeenAt: 1),
            session("asking", status: "awaiting", lastSeenAt: 0),
        ])
        XCTAssertEqual(ranked.map(\.id), ["asking", "working", "idle"])
    }

    func testAwaitingCountExcludesEndedAndZerosWhenStale() {
        let sessions = [
            session("a", status: "awaiting", lastSeenAt: 1),
            session("b", status: "ended", lastSeenAt: 2),
            session("c", status: "working", lastSeenAt: 3),
        ]
        XCTAssertEqual(ActiveSessionsViewModel.awaitingCount(sessions, stale: false), 1)
        // A dead bridge must not keep showing a confident badge.
        XCTAssertEqual(ActiveSessionsViewModel.awaitingCount(sessions, stale: true), 0)
    }

    func testPollIntervalStretchesAfterRepeatedFailures() {
        XCTAssertEqual(RemoteFeed.interval(afterFailures: 0), .seconds(5))
        XCTAssertEqual(RemoteFeed.interval(afterFailures: 2), .seconds(5))
        XCTAssertEqual(RemoteFeed.interval(afterFailures: 3), .seconds(30))
        XCTAssertEqual(RemoteFeed.interval(afterFailures: 10), .seconds(30))
    }
}
