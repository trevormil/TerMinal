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
}
