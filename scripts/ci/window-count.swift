// Prints the number of on-screen, normal-layer windows owned by a pid.
//
// CGWindowListCopyWindowInfo returns owner pid / layer / bounds without any
// TCC prompt — only window *titles* and contents need Screen Recording, and we
// never ask for those. That makes this usable from a CI runner, unlike the
// System Events / AppleScript route, which needs Accessibility.
import CoreGraphics
import Foundation

let target = Int32(CommandLine.arguments.dropFirst().first ?? "") ?? -1
let windows =
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []

let mine = windows.filter { window in
    guard let pid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
        pid == target
    else { return false }
    // Layer 0 is a normal application window; menu bars, tooltips and the like
    // live on higher layers and would be a false positive.
    return ((window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0) == 0
}

print(mine.count)
