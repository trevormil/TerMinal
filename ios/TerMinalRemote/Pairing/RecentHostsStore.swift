import Foundation

/// A Mac paired over Tailscale before, remembered so the next pair is a tap
/// instead of retyping its tailnet address. Just a label and where to reach it —
/// no token (that lives in the Keychain via PairingStore), so UserDefaults is
/// the right home.
struct RecentHost: Codable, Identifiable, Equatable {
    let host: String
    let port: Int
    /// The Mac's name from the pairing response, e.g. "Trevor's MacBook".
    let name: String

    var id: String { "\(host):\(port)" }
    var display: String { port == 8790 ? host : "\(host):\(port)" }
}

enum RecentHostsStore {
    private static let key = "recentTailscaleHosts"
    private static let limit = 8

    static func all() -> [RecentHost] {
        guard let data = UserDefaults.standard.data(forKey: key),
            let hosts = try? JSONDecoder().decode([RecentHost].self, from: data)
        else { return [] }
        return hosts
    }

    /// Upsert, newest first, deduped by host:port. The freshest name wins.
    static func remember(_ host: RecentHost) {
        var hosts = all().filter { $0.id != host.id }
        hosts.insert(host, at: 0)
        if hosts.count > limit { hosts = Array(hosts.prefix(limit)) }
        if let data = try? JSONEncoder().encode(hosts) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    static func forget(_ id: String) {
        let hosts = all().filter { $0.id != id }
        if let data = try? JSONEncoder().encode(hosts) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}
