import XCTest

@testable import TerMinalRemote

final class SSEParserTests: XCTestCase {
    /// Feed lines and collect whatever frames come out.
    private func parse(_ lines: [String]) -> [SSEEvent] {
        var parser = SSEParser()
        return lines.compactMap { parser.push($0) }
    }

    func testParsesASingleFrame() {
        XCTAssertEqual(
            parse(["event: data", "data: aGk=", ""]),
            [SSEEvent(name: "data", data: "aGk=")])
    }

    func testParsesBackToBackFrames() {
        let events = parse([
            "event: data", "data: aGk=", "",
            "event: exit", "data: {\"code\":0}", "",
        ])
        XCTAssertEqual(
            events,
            [
                SSEEvent(name: "data", data: "aGk="),
                SSEEvent(name: "exit", data: "{\"code\":0}"),
            ])
    }

    func testIgnoresKeepaliveComments() {
        // An idle agent session is mostly keepalives; they must not open or
        // terminate a frame, or every idle tick would emit a bogus event.
        let events = parse([": keepalive", "", "event: data", "data: aGk=", ""])
        XCTAssertEqual(events, [SSEEvent(name: "data", data: "aGk=")])
    }

    func testJoinsMultiLineData() {
        XCTAssertEqual(
            parse(["event: x", "data: one", "data: two", ""]),
            [SSEEvent(name: "x", data: "one\ntwo")])
    }

    func testHandlesFieldsWithNoSpaceAfterColon() {
        XCTAssertEqual(parse(["event:data", "data:aGk=", ""]), [SSEEvent(name: "data", data: "aGk=")])
    }

    func testDataMayContainColons() {
        XCTAssertEqual(
            parse(["event: hello", "data: {\"a\":1,\"b\":\"x:y\"}", ""]),
            [SSEEvent(name: "hello", data: "{\"a\":1,\"b\":\"x:y\"}")])
    }

    func testIncompleteFrameYieldsNothing() {
        XCTAssertTrue(parse(["event: data", "data: aGk="]).isEmpty)
    }
}

final class TerminalEventTests: XCTestCase {
    func testDecodesHelloIncludingTheReplay() throws {
        let replay = "previous screen".data(using: .utf8)!
        let json = """
            {"cols":120,"rows":40,"name":"TerMinal","replay":"\(replay.base64EncodedString())"}
            """
        let event = TerminalEvent.from(SSEEvent(name: "hello", data: json))
        XCTAssertEqual(event, .hello(cols: 120, rows: 40, name: "TerMinal", replay: replay))
    }

    func testDecodesOutputBytes() {
        let event = TerminalEvent.from(SSEEvent(name: "data", data: "aGk="))
        XCTAssertEqual(event, .output("hi".data(using: .utf8)!))
    }

    /// Terminal output is arbitrary bytes, not text — escape sequences and
    /// partial UTF-8 must survive the round trip untouched.
    func testPreservesNonUTF8Bytes() {
        let raw = Data([0x1B, 0x5B, 0x32, 0x4A, 0xFF, 0xFE])
        let event = TerminalEvent.from(
            SSEEvent(name: "data", data: raw.base64EncodedString()))
        XCTAssertEqual(event, .output(raw))
    }

    func testDecodesExit() {
        XCTAssertEqual(
            TerminalEvent.from(SSEEvent(name: "exit", data: "{\"code\":130}")),
            .exit(code: 130))
    }

    /// A newer Mac may add frames; an older client must skip them rather than
    /// treating the stream as corrupt.
    func testUnknownEventsDecodeToNil() {
        XCTAssertNil(TerminalEvent.from(SSEEvent(name: "cursor", data: "{}")))
    }

    func testMalformedPayloadsDecodeToNil() {
        XCTAssertNil(TerminalEvent.from(SSEEvent(name: "hello", data: "not json")))
        XCTAssertNil(TerminalEvent.from(SSEEvent(name: "exit", data: "{}")))
        XCTAssertNil(TerminalEvent.from(SSEEvent(name: "data", data: "not base64!!")))
    }
}
