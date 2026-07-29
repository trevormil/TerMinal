import Foundation
import OSLog
import UIKit
import UserNotifications

/// Diagnostics for the one thing that can't be reproduced on a Simulator: a
/// real phone talking to a real Mac. Read with
/// `xcrun devicectl device process launch --console`.
// Subsystem derives from the bundle id so a fork's logs land under its own id
// rather than a hardcoded one.
let bridgeLog = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "terminal", category: "bridge")

/// Registers this device for push and hands the token to the paired Mac.
///
/// There is no push server: the Mac itself signs an APNs JWT and posts to
/// Apple. All this side has to do is ask for permission, get a token, and send
/// it over the bridge we are already authenticated on.
@Observable
final class PushRegistrar: NSObject {
    static let shared = PushRegistrar()

    /// Set once a pairing exists, so the token has somewhere to go.
    var client: BridgeClient?
    private(set) var authorized = false
    /// Where a tapped notification wants to go, consumed once by the UI.
    /// Always non-nil after a tap — see NotificationRoute: every alert resolves
    /// to a destination, falling back to the Inbox rather than to nothing.
    var pendingRoute: NotificationRoute?

    private var lastToken: String?

    func requestAuthorization() async {
        let center = UNUserNotificationCenter.current()
        let granted =
            (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await MainActor.run {
            self.authorized = granted
            if granted { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    /// Called from the app delegate once APNs hands over a token.
    func received(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        lastToken = hex
        Task { await push(hex) }
    }

    /// Re-send on every launch: a token can change, and the Mac's registry may
    /// have been cleared. Registration is idempotent on the Mac side.
    func resend() {
        guard let lastToken else { return }
        Task { await push(lastToken) }
    }

    private func push(_ token: String) async {
        guard let client else { return }
        // A debug build talks to APNs sandbox; TestFlight and the App Store use
        // production. Getting this wrong is a silent delivery failure.
        #if DEBUG
            let environment = "sandbox"
        #else
            let environment = "production"
        #endif
        try? await client.registerDevice(token: token, environment: environment)
    }
}

extension PushRegistrar: UNUserNotificationCenterDelegate {
    /// Show the banner even with the app open — you may be looking at a
    /// different session than the one that needs you.
    ///
    /// Explicit completion-handler form, not `async` — see the note on
    /// `didReceive` below; both delegate methods get the same treatment for
    /// the same reason.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) ->
            Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    /// Explicit completion-handler form, NOT `async`. A device crash log
    /// caught the real bug: the Swift compiler's auto-generated Objective-C
    /// thunk for the `async` variant of this delegate method calls its
    /// completion handler at a point that can race UIKit's own window-scene
    /// connection bookkeeping on a cold launch — crashing (SIGABRT via an
    /// uncaught NSException) inside
    /// `-[UIApplication _updateStateRestorationArchiveForBackgroundEvent:
    /// saveState:exitIfCouldNotRestoreState:updateSnapshot:windowScene:]`,
    /// called from *inside* `@objc closure #1 in
    /// PushRegistrar.userNotificationCenter(_:didReceive:)` — i.e. inside our
    /// own delegate callback's thunk, not anywhere in SwiftUI view code (the
    /// AppLock-timing fixes elsewhere were plausible but addressed a
    /// different, secondary race — this is a completely separate, earlier
    /// point in the launch sequence). Implementing the completion-handler
    /// signature instead bypasses that thunk entirely: we call
    /// completionHandler() ourselves, once we're actually ready.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let route = NotificationRoute(userInfo: response.notification.request.content.userInfo)
        Task { @MainActor in
            self.pendingRoute = route
            completionHandler()
        }
    }
}

/// Minimal delegate: APNs token callbacks have no SwiftUI equivalent.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Must be set before this returns, or a notification tap that cold-
        // launches the app never reaches didReceive and the deep-link is lost.
        UNUserNotificationCenter.current().delegate = PushRegistrar.shared
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushRegistrar.shared.received(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        bridgeLog.error(
            "APNs registration failed: \(error.localizedDescription, privacy: .public)")
    }
}
