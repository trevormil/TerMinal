import XCTest

@testable import TerMinalRemote

final class FleetModelsTests: XCTestCase {
    func testDecodesMachinesInTheOrderTheMacSentThem() throws {
        let json = """
            {"status":"ok","machines":[
              {"name":"laptop","dnsName":"laptop.tailnet.ts.net","os":"macOS","online":true,"self":false},
              {"name":"studio","dnsName":"studio.tailnet.ts.net","os":"macOS","online":true,"self":true},
              {"name":"attic","dnsName":"attic.tailnet.ts.net","os":"linux","online":false,"self":false}
            ]}
            """
        guard case .machines(let machines) = try TailnetFleet.decode(Data(json.utf8)) else {
            return XCTFail("expected machines")
        }
        XCTAssertEqual(machines.map(\.name), ["laptop", "studio", "attic"])
        // `self` is a Swift keyword; the mapping to isSelf is what marks the
        // row you cannot switch to.
        XCTAssertEqual(machines.filter(\.isSelf).map(\.name), ["studio"])
        XCTAssertFalse(machines[2].online)
        XCTAssertEqual(machines[0].id, "laptop.tailnet.ts.net")
    }

    func testUnavailableCarriesTheMacsReason() throws {
        let json = #"{"status":"unavailable","reason":"Tailscale is signed out on this Mac."}"#
        XCTAssertEqual(
            try TailnetFleet.decode(Data(json.utf8)),
            .unavailable("Tailscale is signed out on this Mac."))
    }

    func testUnavailableWithoutAReasonStillReadsAsASentence() throws {
        guard case .unavailable(let reason) = try TailnetFleet.decode(
            Data(#"{"status":"unavailable"}"#.utf8))
        else { return XCTFail("expected unavailable") }
        XCTAssertFalse(reason.isEmpty)
    }

    func testOkWithNoMachinesIsAnEmptyFleetNotAFailure() throws {
        XCTAssertEqual(
            try TailnetFleet.decode(Data(#"{"status":"ok"}"#.utf8)), .machines([]))
    }

    func testHookResultShowsTheMessageOrTheRefusalReason() throws {
        let installed = try JSONDecoder().decode(
            GlobalHookResult.self,
            from: Data(#"{"ok":true,"changed":true,"installed":true,"message":"Added a Stop hook"}"#.utf8))
        XCTAssertEqual(installed.summary, "Added a Stop hook")

        let refused = try JSONDecoder().decode(
            GlobalHookResult.self,
            from: Data(#"{"ok":false,"error":"the hook script isn't on this Mac yet"}"#.utf8))
        XCTAssertEqual(refused.summary, "the hook script isn't on this Mac yet")
    }

    func testHookStatusDecodes() throws {
        let status = try JSONDecoder().decode(
            GlobalHookStatus.self,
            from: Data(
                #"{"installed":false,"settingsPath":"/Users/x/.claude/settings.json","command":"/c/remote-check.sh","commandExists":true}"#
                    .utf8))
        XCTAssertFalse(status.installed)
        XCTAssertTrue(status.commandExists)
        XCTAssertEqual(status.settingsPath, "/Users/x/.claude/settings.json")
    }
}
