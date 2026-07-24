import Foundation

enum BridgeError: LocalizedError, Equatable {
    case unreachable
    case pinMismatch
    case unauthorized
    case sessionGone
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .unreachable:
            return "Can't reach TerMinal. Is the Mac awake and on the same network?"
        case .pinMismatch:
            return "The Mac's identity has changed and no longer matches this pairing. "
                + "Re-pair this device to reconnect."
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
        // the small JSON polling calls this session carries.
        config.timeoutIntervalForRequest = 10
        // The app polls; nothing long-lived rides this session, so a finite
        // ceiling is safe and reclaims any stuck task.
        config.timeoutIntervalForResource = 120
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
        // Trust the cache outright — a health probe per call would double the
        // round trips of the 2s thread poll. `perform` clears it and re-races
        // when a request actually fails.
        if let host { return host }
        for candidate in pairing.h where await isHealthy(candidate) {
            host = candidate
            return candidate
        }
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

    /// Fetch an image's bytes (bearer + pinned, like everything else).
    func imageData(id: String, name: String) async -> Data? {
        guard let (data, response) = try? await perform({
            self.request("v1/remote/\(id)/image/\(name)", host: $0)
        }) else { return nil }
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return data
    }

    func resolveHitl(id: String, resolved: Bool) async throws {
        try await post("v1/hitl/\(id)", body: ["resolved": resolved])
    }

    /// Mark inbox items read (viewed). Read-state is local to the surface.
    func markHitlRead(ids: [String]) async throws {
        try await post("v1/hitl/read", body: ["ids": ids])
    }

    /// Terminate a session — it stays listed, marked ended.
    func endSession(id: String) async throws {
        try await post("v1/remote/\(id)/end", body: nil)
    }

    /// Remove a session for good.
    func deleteSession(id: String) async throws {
        let (_, response) = try await perform {
            self.request("v1/remote/\(id)", host: $0, method: "DELETE")
        }
        try Self.check(response)
    }

    /// Repos the phone may start a session in.
    func repos() async throws -> [RepoOption] {
        struct Envelope: Decodable { let repos: [RepoOption] }
        return try JSONDecoder().decode(Envelope.self, from: try await get("v1/repos")).repos
    }

    // ---- workspaces (per-repo cockpit, read-only) -----------------------

    /// The repo list — same data as repos(), under the workspace route.
    func workspaces() async throws -> [RepoOption] {
        struct Envelope: Decodable { let workspaces: [RepoOption] }
        return try JSONDecoder().decode(Envelope.self, from: try await get("v1/workspaces")).workspaces
    }

    func tickets(repo: String) async throws -> [WsTicket] {
        struct Envelope: Decodable { let tickets: [WsTicket] }
        return try JSONDecoder().decode(
            Envelope.self, from: try await get("v1/workspaces/tickets?repo=\(Self.q(repo))")
        ).tickets
    }

    func prs(repo: String) async throws -> [WsPr] {
        struct Envelope: Decodable { let prs: [WsPr] }
        return try JSONDecoder().decode(
            Envelope.self, from: try await get("v1/workspaces/prs?repo=\(Self.q(repo))")
        ).prs
    }

    func runs(repo: String) async throws -> [WsRun] {
        struct Envelope: Decodable { let runs: [WsRun] }
        return try JSONDecoder().decode(
            Envelope.self, from: try await get("v1/workspaces/runs?repo=\(Self.q(repo))")
        ).runs
    }

    func schedules(repo: String) async throws -> [WsSchedule] {
        struct Envelope: Decodable { let schedules: [WsSchedule] }
        return try JSONDecoder().decode(
            Envelope.self, from: try await get("v1/workspaces/schedules?repo=\(Self.q(repo))")
        ).schedules
    }

    /// Engines available for a new session, already display-cased by the Mac.
    func engines() async throws -> [WsEngine] {
        struct Envelope: Decodable { let engines: [WsEngine] }
        let list = try JSONDecoder().decode(Envelope.self, from: try await get("v1/engines")).engines
        return list.isEmpty ? WsEngine.fallback : list
    }

    // ---- drill-downs: full readable content -----------------------------

    func ticket(repo: String, slug: String) async throws -> WsTicketDetail {
        try JSONDecoder().decode(
            WsTicketDetail.self,
            from: try await get("v1/workspace/ticket?repo=\(Self.q(repo))&slug=\(Self.q(slug))"))
    }

    func pr(repo: String, iid: Int) async throws -> WsPrDetail {
        try JSONDecoder().decode(
            WsPrDetail.self, from: try await get("v1/workspace/pr?repo=\(Self.q(repo))&iid=\(iid)"))
    }

    func prDiff(repo: String, iid: Int) async throws -> WsText {
        try JSONDecoder().decode(
            WsText.self,
            from: try await get("v1/workspace/pr-diff?repo=\(Self.q(repo))&iid=\(iid)"))
    }

    /// `source` comes from the run row — the log store can't be derived from the id.
    func runLog(id: String, source: String, hostId: String?) async throws -> WsText {
        var path = "v1/workspace/run-log?id=\(Self.q(id))&source=\(Self.q(source))"
        if let hostId, !hostId.isEmpty { path += "&host=\(Self.q(hostId))" }
        return try JSONDecoder().decode(WsText.self, from: try await get(path))
    }

    func schedule(repo: String, id: String) async throws -> WsScheduleDetail {
        try JSONDecoder().decode(
            WsScheduleDetail.self,
            from: try await get("v1/workspace/schedule?repo=\(Self.q(repo))&id=\(Self.q(id))"))
    }

    /// Percent-encode a repo path for a query value (slashes and all).
    private static func q(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value
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
        let (data, response) = try await perform { self.request(path, host: $0) }
        try Self.check(response)
        return data
    }

    @discardableResult
    private func post(_ path: String, body: (any Encodable)?) async throws -> Data {
        let encoded = try body.map { try JSONEncoder().encode(AnyEncodable($0)) }
        let (data, response) = try await perform {
            var req = self.request(path, host: $0, method: "POST")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = encoded
            return req
        }
        try Self.check(response)
        return data
    }

    /// One request against the resolved host. If the cached address stopped
    /// answering, drop it, re-race the candidates once, and retry once.
    private func perform(_ makeRequest: (String) -> URLRequest) async throws -> (Data, URLResponse) {
        guard let host = await resolveHost() else { throw BridgeError.unreachable }
        do {
            return try await session.data(for: makeRequest(host))
        } catch {
            let mapped = classify(error)
            guard mapped == .unreachable, Self.isStaleHostError(error) else { throw mapped }
            self.host = nil
            guard let fresh = await resolveHost() else { throw BridgeError.unreachable }
            do {
                return try await session.data(for: makeRequest(fresh))
            } catch {
                throw classify(error)
            }
        }
    }

    private func classify(_ error: Error) -> BridgeError {
        guard let urlError = error as? URLError else { return .unreachable }
        switch urlError.code {
        case .serverCertificateUntrusted, .serverCertificateHasBadDate,
            .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid:
            return .pinMismatch
        case .cancelled where delegate.rejectedPin:
            // -999 is ambiguous: the pinning delegate cancelling the challenge
            // and ordinary Task cancellation look identical. The delegate's
            // flag disambiguates.
            return .pinMismatch
        default:
            return .unreachable
        }
    }

    /// Failures that mean "this address is dead", worth a host re-race — as
    /// opposed to cancellation or a TLS refusal.
    private static func isStaleHostError(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .timedOut, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed,
            .networkConnectionLost, .notConnectedToInternet:
            return true
        default:
            return false
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
