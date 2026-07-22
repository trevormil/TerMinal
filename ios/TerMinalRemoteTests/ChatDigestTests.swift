import XCTest

@testable import TerMinalRemote

final class ChatDigestTests: XCTestCase {
    private func tool(_ id: String, _ name: String, _ status: ChatMessage.ToolStatus = .ok)
        -> ChatMessage
    {
        .tool(id: id, at: Date(), name: name, summary: "x", status: status)
    }
    private func said(_ id: String, _ text: String) -> ChatMessage {
        .assistant(id: id, at: Date(), text: text)
    }

    func testCollapsesARunOfToolCallsIntoOneEntry() {
        let entries = ChatDigest.build([
            said("1", "working on it"),
            tool("2", "Bash"), tool("3", "Edit"), tool("4", "Read"),
            said("5", "done"),
        ])
        XCTAssertEqual(entries.count, 3)
        guard case .work(_, _, let steps, let failed) = entries[1] else {
            return XCTFail("expected a collapsed work entry, got \(entries[1])")
        }
        XCTAssertEqual(steps.count, 3)
        XCTAssertEqual(failed, 0)
    }

    /// Rolling a single call into "1 step" is noise, not a summary.
    func testLeavesALoneToolCallAlone() {
        let entries = ChatDigest.build([said("1", "hi"), tool("2", "Bash"), said("3", "bye")])
        XCTAssertEqual(entries.count, 3)
        if case .work = entries[1] { XCTFail("a single call should not be collapsed") }
    }

    func testCountsFailuresSoTroubleIsVisibleWhileCollapsed() {
        let entries = ChatDigest.build([
            tool("1", "Bash"), tool("2", "Bash", .error), tool("3", "Edit", .error),
        ])
        guard case .work(_, _, _, let failed) = entries[0] else { return XCTFail("not collapsed") }
        XCTAssertEqual(failed, 2)
    }

    func testSummaryUsesHumanVerbsNotToolNames() {
        // Tool names are engine-specific; "7 commands" reads the same either way.
        let claude = ChatDigest.summarize([tool("1", "Bash"), tool("2", "Bash"), tool("3", "Edit")])
        let codex = ChatDigest.summarize([
            tool("1", "exec_command"), tool("2", "exec_command"), tool("3", "apply_patch"),
        ])
        XCTAssertEqual(claude, "2 commands, 1 edit")
        XCTAssertEqual(codex, claude)
    }

    func testKeepsConversationOrder() {
        let entries = ChatDigest.build([
            said("1", "a"), tool("2", "Bash"), tool("3", "Bash"), said("4", "b"),
            tool("5", "Read"), tool("6", "Read"), said("7", "c"),
        ])
        XCTAssertEqual(entries.count, 5)
        XCTAssertEqual(entries.map(\.id), ["1", "work-2", "4", "work-5", "7"])
    }

    func testEmptyTranscriptProducesNothing() {
        XCTAssertTrue(ChatDigest.build([]).isEmpty)
    }
}
