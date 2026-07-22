import Foundation

enum BridgeError: LocalizedError, Equatable {
    case unreachable
    case unauthorized
    case sessionGone
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .unreachable:
            return "Can't reach TerMinal. Is the Mac awake and on the same network?"
        case .unauthorized:
            return "This device is no longer paired. Scan the code again."
        case .sessionGone:
            return "That session is no longer registered."
        case .http(let code):
            return "The bridge returned an unexpected error (\(code))."
        }
    }
}

/// Talks to one paired Mac. Every request carries the bearer token and every
/// connection is pinned to the certificate from the pairing code.
final class BridgeClient {
    let pairing: PairingPayload
    private let session: URLSession
    private let delegate: PinnedSessionDelegate

    /// The address that answered `/v1/health` most recently. Cached so we don't
    /// re-race the candidate list on every request.
    private(set) var host: String?

    init(pairing: PairingPayload) {
        self.pairing = pairing
        self.delegate = PinnedSessionDelegate(fingerprint: pairing.fp)
        let config = URLSessionConfiguration.ephemeral
        // Applies to the gap BETWEEN packets, not the whole request. Fine for
        // the small JSON calls; the stream raises it (see `stream`).
        config.timeoutIntervalForRequest = 10
        // An SSE stream is open indefinitely; without this the OS tears it down
        // mid-session and the terminal appears to freeze.
        config.timeoutIntervalForResource = .infinity
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    }

    private func request(_ path: String, host: String, method: String = "GET") -> URLRequest {
        // String concatenation, NOT appendingPathComponent: that percent-encodes
        // a "?" into the path, so any route with a query string 404s.
        let base = "https://\(host):\(pairing.p)/"
        var req = URLRequest(url: URL(string: base + path)!)
        req.httpMethod = method
        req.setValue("Bearer \(pairing.t)", forHTTPHeaderField: "Authorization")
        return req
    }

    /// Race the candidate addresses and keep the first that answers. The Mac
    /// advertises its tailnet address first, so an off-LAN phone converges on
    /// the address that actually works rather than failing outright.
    @discardableResult
    func resolveHost() async -> String? {
        if let host, await isHealthy(host) { return host }
        for candidate in pairing.h where await isHealthy(candidate) {
            host = candidate
            return candidate
        }
        host = nil
        return nil
    }

    private func isHealthy(_ candidate: String) async -> Bool {
        var req = request("v1/health", host: candidate)
        req.timeoutInterval = 3  // a dead address must not stall the whole race
        guard let (_, response) = try? await session.data(for: req) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    // ---- remote sessions ------------------------------------------------

    /// Registered sessions plus the blocked queue, in one round trip.
    func remote() async throws -> (sessions: [RemoteSession], hitl: [HitlItem]) {
        struct Envelope: Decodable {
            let sessions: [RemoteSession]
            let hitl: [HitlItem]
        }
        let env = try JSONDecoder().decode(Envelope.self, from: try await get("v1/remote"))
        return (env.sessions, env.hitl)
    }

    /// One session's conversation. `after` is an index, so polling transfers
    /// only what is new.
    func messages(id: String, after: Int) async throws -> (
        messages: [RemoteMessage], status: String, question: String?
    ) {
        struct Envelope: Decodable {
            let messages: [RemoteMessage]
            let status: String
            let question: String?
        }
        let env = try JSONDecoder().decode(
            Envelope.self, from: try await get("v1/remote/\(id)/messages?after=\(after)"))
        return (env.messages, env.status, env.question)
    }

    /// Queue a reply. The agent collects it at its next check, so this works
    /// whether or not it is currently blocked asking. Images ride as base64.
    func reply(id: String, text: String, images: [(ext: String, data: Data)] = []) async throws {
        struct Img: Encodable {
            let ext: String
            let data: String
        }
        struct Body: Encodable {
            let text: String
            let images: [Img]
        }
        let body = Body(
            text: text,
            images: images.map { Img(ext: $0.ext, data: $0.data.base64EncodedString()) })
        try await post("v1/remote/\(id)/reply", body: body)
    }

    /// Authenticated URL for an attached image, loaded via `imageData`.
    func imageURL(id: String, name: String) async -> URL? {
        guard let host = await resolveHost() else { return nil }
        return URL(string: "https://\(host):\(pairing.p)/v1/remote/\(id)/image/\(name)")
    }

    /// Fetch an image's bytes (bearer + pinned, like everything else).
    func imageData(id: String, name: String) async -> Data? {
        guard let host = await resolveHost() else { return nil }
        guard let (data, response) = try? await session.data(
            for: request("v1/remote/\(id)/image/\(name)", host: host))
        else { return nil }
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return data
    }

    func resolveHitl(id: String, resolved: Bool) async throws {
        try await post("v1/hitl/\(id)", body: ["resolved": resolved])
    }

    /// Repos the phone may start a session in.
    func repos() async throws -> [RepoOption] {
        struct Envelope: Decodable { let repos: [RepoOption] }
        return try JSONDecoder().decode(Envelope.self, from: try await get("v1/repos")).repos
    }

    /// Start a session on the Mac. Returns the remote thread id, which exists
    /// before the agent finishes booting, so the phone can open it at once.
    func spawn(cwd: String, engine: String?, task: String?) async throws -> String {
        struct Started: Decodable { let id: String }
        var body: [String: String] = ["cwd": cwd]
        if let engine { body["engine"] = engine }
        if let task, !task.isEmpty { body["task"] = task }
        let data = try await post("v1/remote/new", body: body)
        return try JSONDecoder().decode(Started.self, from: data).id
    }

    /// Hand this device's APNs token to the Mac so alerts can reach it.
    func registerDevice(token: String, environment: String) async throws {
        try await post("v1/devices", body: ["token": token, "environment": environment])
    }

    // ---- plumbing -------------------------------------------------------

    private func get(_ path: String) async throws -> Data {
        guard let host = await resolveHost() else { throw BridgeError.unreachable }
        guard let (data, response) = try? await session.data(for: request(path, host: host)) else {
            throw BridgeError.unreachable
        }
        try Self.check(response)
        return data
    }

    @discardableResult
    private func post(_ path: String, body: (any Encodable)?) async throws -> Data {
        guard let host = await resolveHost() else { throw BridgeError.unreachable }
        var req = request(path, host: host, method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { req.httpBody = try JSONEncoder().encode(AnyEncodable(body)) }
        guard let (data, response) = try? await session.data(for: req) else {
            throw BridgeError.unreachable
        }
        try Self.check(response)
        return data
    }

    private static func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw BridgeError.unreachable }
        switch http.statusCode {
        case 200..<300: return
        case 401: throw BridgeError.unauthorized
        case 404: throw BridgeError.sessionGone
        default: throw BridgeError.http(http.statusCode)
        }
    }
}
