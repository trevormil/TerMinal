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
        case unreachable
        case refused
        case notAvailable
        case badResponse

        var errorDescription: String? {
            switch self {
            case .unreachable:
                return "Couldn't reach that Mac on your tailnet. Is it on and is the name right?"
            case .refused:
                return "That Mac didn't recognise this device as the same Tailscale account."
            case .notAvailable:
                return "Tailscale pairing isn't enabled on that Mac."
            case .badResponse:
                return "The Mac sent something unexpected."
            }
        }
    }

    /// `host` is the Mac's MagicDNS name (or any tailnet address); `port` is the
    /// bridge port. Returns a full pairing payload on success.
    static func pair(host: String, port: Int) async throws -> PairingPayload {
        var comps = URLComponents()
        comps.scheme = "https"
        comps.host = host
        comps.port = port
        comps.path = "/v1/pair"
        guard let url = comps.url else { throw Failure.unreachable }

        // Accept the self-signed cert for THIS request only — see the type doc.
        let delegate = AcceptOnceDelegate()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(from: url)
        } catch {
            throw Failure.unreachable
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
private final class AcceptOnceDelegate: NSObject, URLSessionDelegate {
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
