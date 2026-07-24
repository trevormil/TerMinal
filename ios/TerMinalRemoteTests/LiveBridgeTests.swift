import XCTest

@testable import TerMinalRemote

/// Integration test against a running `ios/scripts/e2e-bridge.ts`.
///
/// Skips itself when the harness isn't up, so it never blocks a normal test
/// run. It exists because the offline tests never open a real connection —
/// this is the one place `BridgeClient`'s polling requests (resolve, list,
/// messages, reply) run against an actual bridge end to end.
///
/// The Simulator shares the host filesystem, so the pairing payload is read
/// straight out of the harness log rather than plumbed through env vars.
final class LiveBridgeTests: XCTestCase {
    private func livePairing() throws -> PairingPayload {
        guard let log = try? String(contentsOfFile: "/tmp/harness.log", encoding: .utf8) else {
            throw XCTSkip("no harness log — start ios/scripts/e2e-bridge.ts")
        }
        guard let line = log.split(separator: "\n").first(where: { $0.hasPrefix("{\"v\":1") }),
            let payload = try? PairingPayload.decode(String(line))
        else {
            throw XCTSkip("harness log has no pairing payload")
        }
        return payload
    }

    func testRemoteListLoadsRegisteredSessions() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }
        let (sessions, _) = try await client.remote()
        XCTAssertFalse(sessions.isEmpty, "no registered sessions returned")
    }

    func testTranscriptDecodesAndPaginates() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }
        guard let session = try await client.remote().sessions.first else {
            throw XCTSkip("no registered session")
        }
        let all = try await client.messages(id: session.id, after: 0)
        XCTAssertFalse(all.messages.isEmpty)

        // The same incremental path the thread view polls with.
        let tail = try await client.messages(id: session.id, after: all.messages.count - 1)
        XCTAssertEqual(tail.messages.count, 1)
    }

    /// The regression that matters: a reply must reach the agent, and the
    /// transcript must show it.
    func testReplyLandsInTheTranscript() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }
        guard let session = try await client.remote().sessions.first else {
            throw XCTSkip("no registered session")
        }
        let before = try await client.messages(id: session.id, after: 0)
        let marker = "uitest-\(Int(Date().timeIntervalSince1970))"
        try await client.reply(id: session.id, text: marker)

        let after = try await client.messages(id: session.id, after: before.messages.count)
        XCTAssertTrue(
            after.messages.contains { $0.text == marker && !$0.isAgent },
            "the reply never landed in the transcript")
    }

    func testUnknownSessionIsRejected() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }
        do {
            _ = try await client.messages(id: "no-such-session", after: 0)
            XCTFail("expected an error for an unregistered session")
        } catch {
            // sessionGone is the mapped 404 — anything else means the bridge
            // answered for a session it should not know about.
            XCTAssertEqual(error as? BridgeError, .sessionGone)
        }
    }
}
