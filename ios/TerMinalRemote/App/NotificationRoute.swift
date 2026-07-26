import Foundation

/// Where a tapped notification should take you.
///
/// Every tap resolves to *something*. The original handler read only
/// `threadKey` and looked it up in the registered-session list, so anything
/// that isn't a live remote session — a completion hook, a block, an alert
/// about a desktop-only session — matched nothing and the tap appeared to do
/// nothing at all. `.inbox` is the floor: it is always a valid destination.
enum NotificationRoute: Equatable {
    /// An inbox alert. `hitlId` names the item when the payload carried one.
    case inbox(hitlId: String?)
    /// A live session thread, by its registered key.
    case thread(key: String)

    init(userInfo: [AnyHashable: Any]) {
        // A hitlId is the more specific target: an alert carrying both is about
        // the inbox item, and the run is merely where it came from.
        if let id = NotificationRoute.string(userInfo["hitlId"]) {
            self = .inbox(hitlId: id)
        } else if let key = NotificationRoute.string(userInfo["threadKey"]) {
            self = .thread(key: key)
        } else {
            self = .inbox(hitlId: nil)
        }
    }

    /// APNs payload values are Any — a non-string (or empty) value is treated
    /// as absent rather than force-cast.
    private static func string(_ value: Any?) -> String? {
        guard let s = value as? String, !s.isEmpty else { return nil }
        return s
    }
}
