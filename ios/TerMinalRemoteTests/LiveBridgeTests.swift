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

    /// An idle session must stay open past the client's old 10s inactivity
    /// timeout — the bug that made every quiet terminal look dead.
    func testIdleStreamSurvivesPastTheOldTimeout() async throws {
        let pairing = try livePairing()
        let client = BridgeClient(pairing: pairing)
        guard await client.resolveHost() != nil else {
            throw XCTSkip("harness not reachable")
        }

        let started = Date()
        var frames = 0
        for try await _ in client.stream(key: "e2e-session") {
            frames += 1
            // Keepalives are comments, so they yield no events; simply staying
            // in this loop for >15s without the stream throwing is the proof.
            if Date().timeIntervalSince(started) > 15 { break }
        }
        XCTAssertGreaterThanOrEqual(frames, 1)
        XCTAssertGreaterThan(Date().timeIntervalSince(started), 15, "stream ended early")
    }
}
