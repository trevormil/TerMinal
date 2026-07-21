import XCTest

@testable import TerMinalRemote

final class PairingPayloadTests: XCTestCase {
    private let valid = """
        {"v":1,"n":"Trevor's MacBook","p":8790,"h":["100.126.73.11","192.168.1.42"],\
        "t":"tok","fp":"Zm9vYmFy"}
        """

    func testDecodesAValidCode() throws {
        let payload = try PairingPayload.decode(valid)
        XCTAssertEqual(payload.n, "Trevor's MacBook")
        XCTAssertEqual(payload.p, 8790)
        XCTAssertEqual(payload.h, ["100.126.73.11", "192.168.1.42"])
        XCTAssertEqual(payload.t, "tok")
        XCTAssertEqual(payload.fp, "Zm9vYmFy")
    }

    func testToleratesSurroundingWhitespace() throws {
        // Pasted codes routinely arrive with a trailing newline.
        XCTAssertEqual(try PairingPayload.decode("\n  \(valid)  \n").t, "tok")
    }

    func testRejectsGarbage() {
        for junk in ["", "hello", "{", "https://example.com", "[1,2,3]"] {
            XCTAssertThrowsError(try PairingPayload.decode(junk), "should reject \(junk)")
        }
    }

    func testRejectsAFutureProtocolVersion() {
        let future = valid.replacingOccurrences(of: "\"v\":1", with: "\"v\":2")
        XCTAssertThrowsError(try PairingPayload.decode(future)) { error in
            XCTAssertEqual(error as? PairingPayload.Invalid, .unsupportedVersion(2))
        }
    }

    /// Each of these would produce a client that cannot connect, so pairing must
    /// fail loudly rather than landing on a broken session list.
    func testRejectsCodesThatCouldNotConnect() {
        let cases: [(String, String, String)] = [
            ("\"t\":\"tok\"", "\"t\":\"\"", "token"),
            ("\"fp\":\"Zm9vYmFy\"", "\"fp\":\"\"", "certificate fingerprint"),
            ("\"h\":[\"100.126.73.11\",\"192.168.1.42\"]", "\"h\":[]", "host"),
            ("\"p\":8790", "\"p\":0", "port"),
            ("\"p\":8790", "\"p\":70000", "port"),
        ]
        for (find, replace, field) in cases {
            let broken = valid.replacingOccurrences(of: find, with: replace)
            XCTAssertThrowsError(try PairingPayload.decode(broken), "should reject \(field)") {
                error in
                XCTAssertEqual(error as? PairingPayload.Invalid, .missingField(field))
            }
        }
    }

    /// appendingPathComponent percent-encodes "?", which silently 404s every
    /// route with a query string. Pin the shape the client relies on.
    func testBaseURLConcatenationKeepsAQueryString() throws {
        let payload = try PairingPayload.decode(valid)
        let base = "https://\(payload.h[0]):\(payload.p)/"
        let url = URL(string: base + "v1/chats/abc/messages?after=12")
        XCTAssertEqual(url?.query, "after=12")
        XCTAssertEqual(url?.path, "/v1/chats/abc/messages")
    }

    func testBuildsTheBaseURL() throws {
        let payload = try PairingPayload.decode(valid)
        XCTAssertEqual(
            payload.baseURL(host: "100.126.73.11")?.absoluteString,
            "https://100.126.73.11:8790")
    }
}
