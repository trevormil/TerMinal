import Foundation
import Security

/// Persists the pairing in the Keychain. It carries a bearer token that grants
/// full control of the Mac's terminals, so UserDefaults would be the wrong
/// home for it — this is the one genuinely sensitive thing the app stores.
enum PairingStore {
    private static let service = "com.trevormil.terminal.pairing"
    private static let account = "default"

    static func save(_ payload: PairingPayload) {
        guard let data = try? JSONEncoder().encode(payload) else { return }
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        // The bridge is only reachable while the phone is unlocked and on the
        // network anyway; ThisDeviceOnly keeps the token out of backups.
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load() -> PairingPayload? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return try? JSONDecoder().decode(PairingPayload.self, from: data)
    }

    static func clear() {
        SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ] as CFDictionary)
    }
}
