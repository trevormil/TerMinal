import Foundation

/// A live pty on the Mac, as the bridge reports it.
struct BridgeSession: Codable, Identifiable, Equatable {
    let key: String
    let sessionId: String
    let name: String
    let cwd: String
    let repo: String
    let branch: String
    let model: String
    let status: String
    let cols: Int
    let rows: Int

    var id: String { key }
}

enum BridgeError: LocalizedError {
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
            return "That session has ended."
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
        config.timeoutIntervalForRequest = 10
        // An SSE stream is open indefinitely; without this the OS tears it down
        // mid-session and the terminal appears to freeze.
        config.timeoutIntervalForResource = .infinity
        config.waitsForConnectivity = false
        self.session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    }

    private func request(_ path: String, host: String, method: String = "GET") -> URLRequest {
        var req = URLRequest(url: pairing.baseURL(host: host)!.appendingPathComponent(path))
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

    func sessions() async throws -> [BridgeSession] {
        guard let host = await resolveHost() else { throw BridgeError.unreachable }
        guard let (data, response) = try? await session.data(for: request("v1/sessions", host: host))
        else { throw BridgeError.unreachable }
        try Self.check(response)
        struct Envelope: Decodable { let sessions: [BridgeSession] }
        return (try? JSONDecoder().decode(Envelope.self, from: data))?.sessions ?? []
    }

    /// Send keystrokes to the session's stdin. Control bytes ride through
    /// unchanged, so Ctrl-C from the key bar really interrupts the agent.
    func send(key: String, bytes: Data) async throws {
        guard let host = await resolveHost() else { throw BridgeError.unreachable }
        var req = request("v1/sessions/\(key)/input", host: host, method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["data": bytes.base64EncodedString()])
        guard let (_, response) = try? await session.data(for: req) else {
            throw BridgeError.unreachable
        }
        try Self.check(response)
    }

    /// Live output for one session. The stream ends when the pty exits, the
    /// phone disconnects, or the task is cancelled.
    func stream(key: String) -> AsyncThrowingStream<TerminalEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let host = await resolveHost() else { throw BridgeError.unreachable }
                    let (bytes, response) = try await session.bytes(
                        for: request("v1/sessions/\(key)/stream", host: host))
                    try Self.check(response)

                    var parser = SSEParser()
                    for try await line in bytes.lines {
                        guard let frame = parser.push(line),
                              let event = TerminalEvent.from(frame)
                        else { continue }
                        continuation.yield(event)
                        if case .exit = event { break }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
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
