import XCTest

/// Drives the app to each main screen and attaches a screenshot.
///
/// Not an assertion suite — it exists so a change to the chat UI can be
/// eyeballed without a physical device, and so the harness's real-transcript
/// mode has somewhere to show its output. Run it with `scripts/screenshots.sh`.
final class ScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    private func shoot(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    func testCapturesTheMainScreens() throws {
        let app = XCUIApplication()
        app.launch()

        if app.buttons["Paste pairing code"].waitForExistence(timeout: 15) {
            shoot(app, "01-pairing")
            app.buttons["Paste pairing code"].tap()
            let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                .buttons["Allow Paste"]
            if allow.waitForExistence(timeout: 10) { allow.tap() }
        }

        // Chat list: threads, the needs-you queue, and history. The threads are
        // NavigationLinks in a ScrollView, so match the row's own label rather
        // than a button index — index 0 is the toolbar menu.
        // Tap the BUTTON, not its label: a NavigationLink with .buttonStyle(.plain)
        // does not forward a tap landing on its inner Text.
        let row = app.buttons.matching(
            NSPredicate(format: "label CONTAINS 'harness'")
        ).firstMatch
        _ = row.waitForExistence(timeout: 20)
        Thread.sleep(forTimeInterval: 3)
        shoot(app, "02-chats")

        guard row.exists else { return }
        row.tap()
        Thread.sleep(forTimeInterval: 5)
        shoot(app, "03-thread")
    }
}
