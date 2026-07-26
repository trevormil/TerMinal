import XCTest

@testable import TerMinalRemote

/// A tapped notification must always land somewhere. The original handler read
/// only `threadKey` and resolved it against the registered-session list, so a
/// completion hook or block — which is an inbox item, not a session — matched
/// nothing and the app opened to whatever was last on screen.
final class NotificationRouteTests: XCTestCase {
    func testInboxAlertRoutesToItsInboxItem() {
        let route = NotificationRoute(userInfo: ["hitlId": "h-42"])
        XCTAssertEqual(route, .inbox(hitlId: "h-42"))
    }

    func testSessionAlertRoutesToItsThread() {
        let route = NotificationRoute(userInfo: ["threadKey": "run-7"])
        XCTAssertEqual(route, .thread(key: "run-7"))
    }

    // A hitlId is the more specific target: an alert carrying both is about the
    // inbox item, and the run is just where it came from.
    func testHitlIdWinsWhenBothArePresent() {
        let route = NotificationRoute(userInfo: ["threadKey": "run-7", "hitlId": "h-42"])
        XCTAssertEqual(route, .inbox(hitlId: "h-42"))
    }

    // The reported bug: notifications with neither key (or empty ones) left the
    // app with nothing to do. Landing on the Inbox beats landing nowhere.
    func testAnAlertWithNoTargetStillLandsOnTheInbox() {
        XCTAssertEqual(NotificationRoute(userInfo: [:]), .inbox(hitlId: nil))
        XCTAssertEqual(NotificationRoute(userInfo: ["threadKey": ""]), .inbox(hitlId: nil))
        XCTAssertEqual(NotificationRoute(userInfo: ["hitlId": ""]), .inbox(hitlId: nil))
    }

    func testNonStringPayloadValuesAreIgnoredRatherThanCrashing() {
        XCTAssertEqual(NotificationRoute(userInfo: ["threadKey": 12]), .inbox(hitlId: nil))
        XCTAssertEqual(NotificationRoute(userInfo: ["hitlId": NSNull()]), .inbox(hitlId: nil))
    }
}
