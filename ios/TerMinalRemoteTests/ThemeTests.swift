import SwiftUI
import XCTest

@testable import TerMinalRemote

final class ThemeTests: XCTestCase {
    /// A wrong PostScript name silently falls back to the system face, so the
    /// app would still build and run — just not look like TerMinal. IBM
    /// abbreviates its names ("Medm", "SmBld"), which is easy to get wrong.
    func testEveryBundledFontRegisters() {
        for name in GT.fontNames {
            XCTAssertTrue(
                GT.registered(name),
                "\(name) is not registered — check UIAppFonts and the PostScript name")
        }
    }

    func testWeightsMapToDistinctFaces() {
        // If these collapsed to one face the UI would lose its hierarchy.
        XCTAssertNotEqual(GT.sans(12, .regular), GT.sans(12, .semibold))
        XCTAssertNotEqual(GT.mono(12, .regular), GT.mono(12, .medium))
    }
}
