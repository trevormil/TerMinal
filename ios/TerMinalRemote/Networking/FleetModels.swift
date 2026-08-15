import Foundation

/// One machine on the paired Mac's tailnet, from `GET /v1/tailnet`.
struct TailnetMachine: Decodable, Identifiable, Equatable {
    let name: String
    /// MagicDNS name, no trailing dot — what the phone pairs against.
    let dnsName: String
    let os: String
    let online: Bool
    /// The Mac currently answering, i.e. the one this phone already drives.
    let isSelf: Bool

    var id: String { dnsName.isEmpty ? name : dnsName }

    // `self` is a Swift keyword, so the wire name is mapped explicitly.
    enum CodingKeys: String, CodingKey {
        case name, dnsName, os, online
        case isSelf = "self"
    }
}

/// The fleet, or a plain sentence about why there isn't one. Tailscale being
/// stopped or absent is a state to render, never an error to throw: the phone
/// is plainly talking to the Mac, so "can't reach TerMinal" would be a lie.
enum TailnetFleet: Equatable {
    case machines([TailnetMachine])
    case unavailable(String)

    private struct Wire: Decodable {
        let status: String
        let machines: [TailnetMachine]?
        let reason: String?
    }

    static func decode(_ data: Data) throws -> TailnetFleet {
        let wire = try JSONDecoder().decode(Wire.self, from: data)
        if wire.status == "ok" { return .machines(wire.machines ?? []) }
        return .unavailable(
            wire.reason?.isEmpty == false
                ? wire.reason! : "Tailscale isn't available on that Mac.")
    }
}

/// State of the never-die Stop hook in the Mac's ~/.claude/settings.json.
struct GlobalHookStatus: Decodable, Equatable {
    let installed: Bool
    let settingsPath: String
    let command: String
    /// False when the tm plugin hasn't been installed on that Mac yet.
    let commandExists: Bool
}

/// What an install/uninstall did. `ok: false` is a reported outcome with a
/// reason the user can act on — not a transport failure.
struct GlobalHookResult: Decodable, Equatable {
    let ok: Bool
    let changed: Bool?
    let installed: Bool?
    let message: String?
    let error: String?

    /// The one line to show, whichever way it went.
    var summary: String {
        if ok { return message ?? "Done." }
        return error ?? "The Mac refused the change."
    }
}
