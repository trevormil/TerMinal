import XCTest

/// Drives the real app against a real bridge.
///
/// Requires `ios/scripts/e2e-bridge.ts` to be running with its pairing code on
/// the simulator pasteboard — `scripts/e2e-app.sh` does both. This is the test
/// that catches what every offline unit test happily passes: ATS blocking the
/// connection, a certificate-pinning mismatch, or a bad Authorization header.
///
/// It deliberately stops at the session list. Opening a session starts an SSE
/// stream and a continuously redrawing SwiftTerm view, so the app never reaches
/// the quiescent state XCUITest requires before answering a query — assertions
/// past that point time out whether or not the app works. That half of the
/// round trip is covered by `e2e-bridge.ts --selftest`, which drives input into
/// a real pty and reads the output back off the SSE stream.
final class LivePairingTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testPairsAndListsChats() throws {
        let app = XCUIApplication()
        app.launch()

        // Pairing screen. The Simulator has no camera, so use the paste path —
        // the harness put the code on the pasteboard.
        let pasteButton = app.buttons["Paste pairing code"]
        XCTAssertTrue(
            pasteButton.waitForExistence(timeout: 15),
            "expected the pairing screen; is the app already paired? "
                + "(scripts/e2e-app.sh resets the simulator keychain first)")
        pasteButton.tap()

        // iOS asks for paste consent the first time. The alert belongs to
        // SpringBoard, not to us — querying `app` for it can never match, and
        // the unanswered alert then blocks every subsequent query.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allowPaste = springboard.buttons["Allow Paste"]
        if allowPaste.waitForExistence(timeout: 10) { allowPaste.tap() }

        // The list is titled with the Mac's name from the pairing payload, so
        // reaching it proves the code decoded and the client adopted it.
        XCTAssertTrue(
            app.navigationBars["e2e harness"].waitForExistence(timeout: 15),
            "never reached the session list — pairing failed")

        // The harness session's thread proves a certificate-pinned,
        // token-authenticated HTTPS request reached the bridge and decoded.
        XCTAssertTrue(
            app.staticTexts["harness demo"].waitForExistence(timeout: 20),
            "session list never loaded a registered session")

        // …and the HITL queue renders from the same payload.
        XCTAssertTrue(
            app.staticTexts["Approve release to production"].exists,
            "the needs-you queue did not render")

        XCTAssertFalse(
            app.staticTexts["This device is no longer paired. Scan the code again."].exists,
            "the bridge rejected the token")
    }
}
