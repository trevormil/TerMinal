import XCTest

@testable import TerMinalRemote

/// Ticket 128: New Session now starts a real agent on the Mac, so what the sheet
/// puts on the wire decides which engine actually launches, in which repo. The
/// body builder is pure, so it is tested directly — no bridge needed.
final class SpawnRequestTests: XCTestCase {
    func testCarriesTheRepoTheUserPicked() {
        let body = BridgeClient.spawnBody(cwd: "/code/TerMinal", engine: nil, effort: nil, task: nil)
        XCTAssertEqual(body["cwd"], "/code/TerMinal")
    }

    func testCarriesEngineEffortAndTask() {
        let body = BridgeClient.spawnBody(
            cwd: "/code/x", engine: "codex", effort: "high", task: "fix the flake")
        XCTAssertEqual(body["engine"], "codex")
        XCTAssertEqual(body["effort"], "high")
        XCTAssertEqual(body["task"], "fix the flake")
    }

    /// A missing key means "use the Mac's default". Sending an empty string
    /// instead would ask for an engine/effort that does not exist.
    func testOmitsEmptyValuesRatherThanSendingThemBlank() {
        let body = BridgeClient.spawnBody(cwd: "/code/x", engine: "", effort: "", task: "")
        XCTAssertEqual(Array(body.keys), ["cwd"])
    }

    func testOmitsNilValues() {
        let body = BridgeClient.spawnBody(cwd: "/code/x", engine: nil, effort: nil, task: nil)
        XCTAssertNil(body["engine"])
        XCTAssertNil(body["effort"])
        XCTAssertNil(body["task"])
    }
}
