import XCTest

@testable import TerMinalRemote

/// The bootstrap pair request accepts any certificate on the assumption the
/// traffic rides the WireGuard tunnel. That assumption only holds when the
/// typed host is actually a tailnet address — these tests pin the validator
/// that enforces it.
final class TailnetHostTests: XCTestCase {
    func testAcceptsCGNATRangeAddresses() {
        XCTAssertTrue(TailscalePairing.isTailnetHost("100.64.0.1"))
        XCTAssertTrue(TailscalePairing.isTailnetHost("100.126.73.11"))
    }

    func testAcceptsMagicDNSNames() {
        XCTAssertTrue(TailscalePairing.isTailnetHost("foo.tailnet-name.ts.net"))
        XCTAssertTrue(TailscalePairing.isTailnetHost("Foo.Tailnet-Name.TS.NET"))
        // A bare short name resolves only via tailnet DNS.
        XCTAssertTrue(TailscalePairing.isTailnetHost("mymac"))
    }

    func testAcceptsTailscaleULARange() {
        XCTAssertTrue(TailscalePairing.isTailnetHost("fd7a:115c:a1e0::1"))
        XCTAssertTrue(TailscalePairing.isTailnetHost("FD7A:115C:A1E0:ab12::7"))
    }

    func testRejectsLANAndInternetAddresses() {
        XCTAssertFalse(TailscalePairing.isTailnetHost("192.168.1.10"))
        XCTAssertFalse(TailscalePairing.isTailnetHost("8.8.8.8"))
        XCTAssertFalse(TailscalePairing.isTailnetHost("example.com"))
        XCTAssertFalse(TailscalePairing.isTailnetHost("::1"))
        XCTAssertFalse(TailscalePairing.isTailnetHost(""))
    }

    /// The /10 boundary: one below the range and one past it must both fail.
    func testRejectsAddressesJustOutsideTheCGNATRange() {
        XCTAssertFalse(TailscalePairing.isTailnetHost("100.63.255.255"))
        XCTAssertFalse(TailscalePairing.isTailnetHost("100.128.0.0"))
    }
}
