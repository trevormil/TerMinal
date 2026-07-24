import CryptoKit
import Foundation
import LocalAuthentication
import Security
import SwiftUI

/// In-app passcode gate. Deliberately NOT the iOS-level "Require Face ID"
/// app lock — that suppresses notification previews system-wide, which defeats
/// the whole point of push. This lock lives inside the app: contents are
/// gated, notifications stay readable.
///
/// The passcode is stored as salted SHA-256 in the Keychain (never plaintext,
/// never in UserDefaults). Optional biometric unlock uses LocalAuthentication
/// in-app, with the passcode as fallback.
@Observable
final class AppLock {
    static let shared = AppLock()

    /// Locked until proven otherwise: if a passcode exists, the app starts
    /// locked and re-locks whenever it leaves the foreground.
    private(set) var locked: Bool

    private init() {
        locked = Self.passcodeSet()
    }

    // ---- state ----------------------------------------------------------

    var isEnabled: Bool { Self.passcodeSet() }

    var biometricsOptIn: Bool {
        get { UserDefaults.standard.bool(forKey: "appLock.biometrics") }
        set { UserDefaults.standard.set(newValue, forKey: "appLock.biometrics") }
    }

    func lockIfEnabled() {
        if isEnabled { locked = true }
    }

    func unlock(with passcode: String) -> Bool {
        guard Self.verify(passcode) else { return false }
        locked = false
        return true
    }

    /// In-app Face ID / Touch ID — succeeds silently or falls back to the pad.
    func unlockWithBiometrics() async {
        guard isEnabled, biometricsOptIn else { return }
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else {
            return
        }
        let ok = (try? await ctx.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "Unlock TerMinal")) ?? false
        if ok { await MainActor.run { locked = false } }
    }

    /// Digits in the stored passcode (4 or 6), so the lock pad shows the right
    /// dot count and auto-submits at the right length. 0 when none set.
    var passcodeLength: Int { UserDefaults.standard.integer(forKey: "appLock.length") }

    func setPasscode(_ code: String) {
        Self.store(code)
        UserDefaults.standard.set(code.count, forKey: "appLock.length")
        // Setting a passcode shouldn't lock you out of the session you're in.
        locked = false
    }

    func removePasscode() {
        Self.deleteRecord()
        locked = false
    }

    // ---- keychain-backed salted hash ------------------------------------

    private static let service =
        (Bundle.main.bundleIdentifier ?? "terminal") + ".applock"
    private static let account = "passcode"

    private static func digest(_ code: String, salt: Data) -> Data {
        var input = salt
        input.append(Data(code.utf8))
        return Data(SHA256.hash(data: input))
    }

    private static func store(_ code: String) {
        var salt = Data(count: 16)
        _ = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        let record = salt + digest(code, salt: salt)
        deleteRecord()
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: record,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func readRecord() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    private static func deleteRecord() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func passcodeSet() -> Bool { readRecord() != nil }

    static func verify(_ code: String) -> Bool {
        guard let record = readRecord(), record.count > 16 else { return false }
        let salt = record.prefix(16)
        let stored = record.dropFirst(16)
        return digest(code, salt: Data(salt)) == Data(stored)
    }
}
