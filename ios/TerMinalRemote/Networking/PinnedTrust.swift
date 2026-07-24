import CryptoKit
import Foundation

/// Certificate pinning for the bridge.
///
/// The Mac serves a self-signed certificate, so chain validation against a
/// public CA is meaningless here. Instead the QR carries the SHA-256 of that
/// exact certificate and we accept only that one — strictly stronger than
/// normal CA validation, since no third party can issue a certificate we'd
/// trust for this connection.
enum PinnedTrust {
    /// base64 SHA-256 of a DER-encoded certificate — the pinned form.
    static func fingerprint(ofDER der: Data) -> String {
        Data(SHA256.hash(data: der)).base64EncodedString()
    }

    /// True when the leaf certificate of `trust` is exactly the pinned one.
    static func matches(trust: SecTrust, fingerprint pinned: String) -> Bool {
        guard !pinned.isEmpty else { return false }
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first
        else { return false }
        let der = SecCertificateCopyData(leaf) as Data
        // Constant-time is unnecessary: the fingerprint is public (it rides in
        // the QR) and an attacker gains nothing by learning it.
        return fingerprint(ofDER: der) == pinned
    }
}

/// URLSession delegate that accepts the pinned certificate and nothing else.
///
/// Conforms to BOTH `URLSessionDelegate` and `URLSessionTaskDelegate` on
/// purpose. `data(for:)` routes its auth challenge to the session-level method,
/// but `bytes(for:)` — the one the SSE stream uses — consults the TASK-level
/// method instead. Implementing only the session-level one meant every plain
/// request authenticated fine while the stream silently failed its TLS
/// handshake with NSURLErrorServerCertificateUntrusted (-1202), so the bridge
/// never even saw the request.
final class PinnedSessionDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    private let fingerprint: String

    init(fingerprint: String) {
        self.fingerprint = fingerprint
    }

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
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        if PinnedTrust.matches(trust: trust, fingerprint: fingerprint) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            // Wrong certificate: could be a stale pairing after the Mac
            // regenerated its identity, or someone impersonating the bridge.
            // Either way, refuse — never fall back to default handling.
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}
