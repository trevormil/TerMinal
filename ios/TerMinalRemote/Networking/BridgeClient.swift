import Foundation

/// A live pty on the Mac, as the bridge reports it.
struct BridgeSession: Codable, Identifiable, Hashable {
    let key: String
    let sessionId: String
    let name: String
    let cwd: String
    let repo: String
    let branch: String
    let model: String
    let status: String
    let engine: String
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
                    var req = request("v1/sessions/\(key)/stream", host: host)
                    // An idle agent emits nothing for minutes, and this timeout
                    // measures the gap between packets — at the default 10s the
                    // stream is killed before the server's 10s keepalive lands,
                    // so every quiet session looked like a dead connection.
                    // 6x the keepalive interval leaves room for a missed one.
                    req.timeoutInterval = 60
                    let (bytes, response) = try await session.bytes(for: req)
                    try Self.check(response)

                    // Hand-rolled line splitting, NOT `bytes.lines`.
                    // AsyncLineSequence drops empty lines, and an empty line is
                    // exactly how SSE terminates a frame — so with `.lines` the
                    // parser never sees a frame end and no event is ever
                    // emitted, even though the connection is healthy and data
                    // is flowing. That produced a permanent "connecting" spinner.
                    var parser = SSEParser()
                    var buffer: [UInt8] = []
                    for try await byte in bytes {
                        guard byte == 0x0A else {
                            buffer.append(byte)
                            continue
                        }
                        if buffer.last == 0x0D { buffer.removeLast() }
                        let line = String(decoding: buffer, as: UTF8.self)
                        buffer.removeAll(keepingCapacity: true)
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

    // ---- chat surface -------------------------------------------------

    /// Threads plus the HITL queue, in one round trip — the chat list needs both.
    func chats() async throws -> (threads: [ChatThread], hitl: [HitlItem]) {
        struct Envelope: Decodable {
            let threads: [ChatThread]
            let hitl: [HitlItem]
        }
        let data = try await get("v1/chats")
        let env = try JSONDecoder().decode(Envelope.self, from: data)
        return (env.threads, env.hitl)
    }

    /// One session's conversation. `after` is an index into the full list, so
    /// polling for new messages doesn't re-transfer the whole transcript.
    func messages(key: String, after: Int) async throws -> ChatTranscriptPage {
        struct Meta: Decodable {
            let unsupported: Bool
            let total: Int
            let status: String
        }
        let data = try await get("v1/chats/\(key)/messages?after=\(after)")
        let meta = try JSONDecoder().decode(Meta.self, from: data)
        return ChatTranscriptPage(
            messages: try ChatMessage.decode(data, startIndex: after),
            unsupported: meta.unsupported,
            total: meta.total,
            status: meta.status
        )
    }

    /// Send a prompt. The Mac appends the carriage return.
    func sendPrompt(key: String, text: String) async throws {
        try await post("v1/chats/\(key)/send", body: ["text": text])
    }

    func interrupt(key: String) async throws {
        try await post("v1/chats/\(key)/interrupt", body: nil)
    }

    func resolveHitl(id: String, resolved: Bool) async throws {
        try await post("v1/hitl/\(id)", body: ["resolved": resolved])
    }

    func repos() async throws -> [RepoOption] {
        struct Envelope: Decodable { let repos: [RepoOption] }
        return try JSONDecoder().decode(Envelope.self, from: try await get("v1/repos")).repos
    }

    /// Start a session on the Mac. Returns its key so the UI can open it.
    func startSession(cwd: String, engine: String?, name: String?) async throws -> String {
        struct Started: Decodable { let key: String }
        var body: [String: String] = ["cwd": cwd]
        if let engine { body["engine"] = engine }
        if let name { body["name"] = name }
        let data = try await post("v1/sessions", body: body)
        return try JSONDecoder().decode(Started.self, from: data).key
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
