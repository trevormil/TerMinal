import XCTest

@testable import TerMinalRemote

/// The append gate for a fetched transcript page is pure, so it's tested
/// directly — no bridge needed.
final class RemoteThreadTests: XCTestCase {
    func testAppliesPageWhenNothingChangedInFlight() {
        XCTAssertTrue(
            RemoteThreadViewModel.shouldApply(pageCount: 3, requestedAfter: 5, currentCount: 5))
    }

    func testDropsPageWhenAnotherRefreshAppendedFirst() {
        // Two refreshes both asked for after=5; the first appended 3 messages,
        // so the second's identical page must be dropped, not re-appended.
        XCTAssertFalse(
            RemoteThreadViewModel.shouldApply(pageCount: 3, requestedAfter: 5, currentCount: 8))
    }

    func testDropsEmptyPage() {
        XCTAssertFalse(
            RemoteThreadViewModel.shouldApply(pageCount: 0, requestedAfter: 5, currentCount: 5))
    }
}
