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
    /// Thread key from a tapped notification, consumed by the UI to deep-link.
    var pendingThreadKey: String?

    private var lastToken: String?

    func requestAuthorization() async {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
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
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        if let key = info["threadKey"] as? String, !key.isEmpty {
            await MainActor.run { self.pendingThreadKey = key }
        }
    }
}

/// Minimal delegate: APNs token callbacks have no SwiftUI equivalent.
final class AppDelegate: NSObject, UIApplicationDelegate {
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
