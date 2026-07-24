import Foundation

/// Pair over the tailnet: no QR, no code. The phone connects to the Mac's
/// MagicDNS name and asks for the token; the Mac authenticates the caller by
/// tailnet identity (`tailscale whois`) and hands it over.
///
/// The bootstrap `GET /v1/pair` is the one request that cannot pin — the phone
/// has no fingerprint yet. That is safe here because the whole exchange runs
/// inside the WireGuard tunnel, which is already encrypted and mutually
/// authenticated; the token and fingerprint come back over it, and every
/// request after pairing pins normally.
enum TailscalePairing {
    enum Failure: LocalizedError {
        case detailed(String)
        case refused
        case notAvailable
        case badResponse

        var errorDescription: String? {
            switch self {
            case .detailed(let why):
                return why
            case .refused:
                return "That Mac didn't recognise this device as the same Tailscale account."
            case .notAvailable:
                return "Tailscale pairing isn't enabled on that Mac."
            case .badResponse:
                return "The Mac sent something unexpected."
            }
        }
    }

    /// True only for hosts that provably route over the tailnet. The bootstrap
    /// pair request skips certificate pinning on the assumption the traffic
    /// rides the WireGuard tunnel — so the typed host must be a tailnet
    /// address, never a LAN or internet one.
    static func isTailnetHost(_ host: String) -> Bool {
        let h = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !h.isEmpty else { return false }
        // MagicDNS: full *.ts.net names.
        if h.hasSuffix(".ts.net") { return true }
        // Tailscale CGNAT IPv4 range: 100.64.0.0/10.
        let parts = h.split(separator: ".", omittingEmptySubsequences: false)
        if parts.count == 4 {
            let octets = parts.compactMap { UInt8($0) }
            return octets.count == 4 && octets[0] == 100 && (64...127).contains(octets[1])
        }
        // Raw IPv6 (incl. Tailscale's fd7a: ULA range) is rejected: the rest of
        // the pipeline can't complete it — PairingPayload.baseURL builds URLs
        // without brackets and the Mac's /v1/pair gate only vouches for IPv4
        // CGNAT peers. Tailnet IPv6 users still pair via the MagicDNS name.
        if h.contains(":") { return false }
        // A bare MagicDNS short name (no dots) can only resolve via tailnet DNS.
        return !h.contains(".")
    }

    /// `host` is the Mac's MagicDNS name (or any tailnet address); `port` is the
    /// bridge port. Returns a full pairing payload on success.
    static func pair(host: String, port: Int) async throws -> PairingPayload {
        guard isTailnetHost(host) else {
            throw Failure.detailed(
                "\"\(host)\" isn't a Tailscale address. Tailscale pairing skips "
                    + "certificate checks because the tunnel already secures the "
                    + "connection — that's only safe for tailnet addresses "
                    + "(100.x.y.z, *.ts.net, or a MagicDNS name). For a LAN "
                    + "address, use QR pairing instead.")
        }
        var comps = URLComponents()
        comps.scheme = "https"
        comps.host = host
        comps.port = port
        comps.path = "/v1/pair"
        guard let url = comps.url else { throw Failure.detailed("bad host") }

        // Per-task delegate (iOS 15+): attach the trust handler directly to the
        // request. A session-level delegate wasn't being consulted for this
        // one-off async call, so the self-signed cert failed the handshake
        // (-1200); this form routes the challenge to our delegate reliably.
        let delegate = AcceptOnceDelegate()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        let session = URLSession(configuration: config)
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request, delegate: delegate)
        } catch let urlError as URLError {
            // Report the actual reason — "unreachable" hid TLS and DNS failures.
            throw Failure.detailed(
                "\(url.host ?? "host"):\(port) — \(urlError.localizedDescription) "
                    + "[\(urlError.code.rawValue)]")
        } catch {
            throw Failure.detailed(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw Failure.badResponse }
        switch http.statusCode {
        case 200: break
        case 403: throw Failure.refused
        case 501: throw Failure.notAvailable
        default: throw Failure.badResponse
        }

        struct PairResult: Decodable {
            let token: String
            let fp: String
            let name: String
        }
        guard let result = try? JSONDecoder().decode(PairResult.self, from: data) else {
            throw Failure.badResponse
        }
        // Build the same payload a QR would carry. The tailnet host is what the
        // client should reach; the pinned fingerprint is now known.
        return PairingPayload(
            v: 1, n: result.name, p: port, h: [host], t: result.token, fp: result.fp)
    }
}

/// Accepts any server cert. Used ONLY for the bootstrap pair request, which
/// runs inside the WireGuard tunnel before a fingerprint is known.
private final class AcceptOnceDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    // Both levels, like PinnedSessionDelegate: data(from:) uses the session
    // method, but keep the task one so no code path is left unhandled.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        urlSession(session, didReceive: challenge, completionHandler: completionHandler)
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
            let trust = challenge.protectionSpace.serverTrust
        {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
