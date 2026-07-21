import XCTest

@testable import TerMinalRemote

/// Integration test against a running `ios/scripts/e2e-bridge.ts`.
///
/// Skips itself when the harness isn't up, so it never blocks a normal test
/// run. It exists because the offline tests exercise the SSE *parser* but
/// never `BridgeClient.stream()` itself — the one path that actually opens a
/// connection — so a stream that never issues a request passed everything.
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

    func testSessionsListLoadsFromTheLiveBridge() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else {
            throw XCTSkip("harness not reachable")
        }
        let sessions = try await client.sessions()
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions.first?.key, "e2e-session")
    }

    /// The regression that mattered: the phone listed sessions fine but the
    /// bridge never saw a stream request at all.
    func testStreamDeliversAHelloFrame() async throws {
        let pairing = try livePairing()
        let client = BridgeClient(pairing: pairing)
        guard await client.resolveHost() != nil else {
            throw XCTSkip("harness not reachable")
        }

        var received: TerminalEvent?
        let deadline = Date().addingTimeInterval(20)
        for try await event in client.stream(key: "e2e-session") {
            received = event
            break
        }
        XCTAssertLessThan(Date(), deadline, "stream took too long to produce a frame")

        guard case .hello(let cols, let rows, _, _) = received else {
            return XCTFail("expected a hello frame, got \(String(describing: received))")
        }
        XCTAssertEqual(cols, 100)
        XCTAssertEqual(rows, 30)
    }

    // MARK: - chat surface

    func testChatsListsThreadsAndTheHitlQueue() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }

        let (threads, hitl) = try await client.chats()
        XCTAssertTrue(threads.contains { $0.key == "e2e-session" && $0.live })
        // History threads are read-only and must be flagged as such, or the UI
        // would offer a composer that writes to a dead pty.
        XCTAssertTrue(threads.contains { $0.key.hasPrefix("past:") && !$0.live })
        XCTAssertEqual(hitl.first?.id, "h1")
    }

    func testSendingAPromptAppearsInTheTranscript() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }

        let before = try await client.messages(key: "e2e-session", after: 0)
        let marker = "uitest-\(Int(Date().timeIntervalSince1970))"
        try await client.sendPrompt(key: "e2e-session", text: marker)

        // Fetch only what is new — the same incremental path the thread view
        // uses, so a broken `after` shows up here.
        let after = try await client.messages(key: "e2e-session", after: before.total)
        XCTAssertGreaterThan(after.total, before.total)
        let texts = after.messages.compactMap { message -> String? in
            if case .user(_, _, let text) = message { return text }
            if case .assistant(_, _, let text) = message { return text }
            return nil
        }
        XCTAssertTrue(texts.contains { $0.contains(marker) }, "the prompt never landed: \(texts)")
    }

    func testResolvingAHitlItemClearsIt() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }
        guard let item = try await client.chats().hitl.first else {
            throw XCTSkip("harness queue already drained")
        }
        try await client.resolveHitl(id: item.id, resolved: true)
        let remaining = try await client.chats().hitl
        XCTAssertFalse(remaining.contains { $0.id == item.id })
    }

    func testReposAreOfferedForStartingASession() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }
        let repos = try await client.repos()
        XCTAssertFalse(repos.isEmpty)
        XCTAssertTrue(repos.contains { $0.name == "TerMinal" })
    }

    /// An idle session must stay open past the client's old 10s inactivity
    /// timeout — the bug that made every quiet terminal look dead.
    func testIdleStreamSurvivesPastTheOldTimeout() async throws {
        let client = BridgeClient(pairing: try livePairing())
        guard await client.resolveHost() != nil else { throw XCTSkip("harness not reachable") }

        // Race the stream against a clock rather than iterating for a while:
        // an idle session emits only keepalive COMMENTS, which yield no events,
        // so a `for await` loop would block instead of re-checking the time.
        let survived = await withTaskGroup(of: Bool.self) { group -> Bool in
            group.addTask {
                do {
                    for try await _ in client.stream(key: "e2e-session") {}
                    return false  // the stream ended on its own — that's the bug
                } catch {
                    return false
                }
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(16))
                return true  // still open past the old 10s timeout
            }
            let first = await group.next() ?? false
            group.cancelAll()
            return first
        }
        XCTAssertTrue(survived, "the stream closed before 16s of silence")
    }
}
