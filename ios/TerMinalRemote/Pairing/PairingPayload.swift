import Foundation

/// The contents of the pairing QR shown in TerMinal → Settings → Mobile.
///
/// Field names are single letters to keep the QR's module count low enough for
/// a phone camera to lock on quickly; they must stay in lockstep with
/// `pairingPayload()` in `src/main/bridge/identity.ts`.
struct PairingPayload: Codable, Equatable {
    let v: Int
    /// Display name of the Mac.
    let n: String
    /// Bridge port.
    let p: Int
    /// Candidate addresses, tailnet first.
    let h: [String]
    /// Bearer token, sent on every request.
    let t: String
    /// base64 SHA-256 of the DER certificate the bridge presents.
    let fp: String

    enum Invalid: LocalizedError, Equatable {
        case notJSON
        case unsupportedVersion(Int)
        case missingField(String)

        var errorDescription: String? {
            switch self {
            case .notJSON:
                return "That doesn't look like a TerMinal pairing code."
            case .unsupportedVersion(let v):
                return "This pairing code is version \(v). Update the app to pair with this Mac."
            case .missingField(let f):
                return "The pairing code is incomplete (missing \(f))."
            }
        }
    }

    /// Parse and validate a scanned or pasted code. Rejects anything that would
    /// produce a client that cannot actually connect, so failures surface at
    /// pairing time rather than as a mystery error on the session list.
    static func decode(_ raw: String) throws -> PairingPayload {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8),
              let payload = try? JSONDecoder().decode(PairingPayload.self, from: data)
        else { throw Invalid.notJSON }

        guard payload.v == 1 else { throw Invalid.unsupportedVersion(payload.v) }
        guard !payload.t.isEmpty else { throw Invalid.missingField("token") }
        guard !payload.fp.isEmpty else { throw Invalid.missingField("certificate fingerprint") }
        guard !payload.h.isEmpty else { throw Invalid.missingField("host") }
        guard (1...65535).contains(payload.p) else { throw Invalid.missingField("port") }
        return payload
    }

    func baseURL(host: String) -> URL? {
        URL(string: "https://\(host):\(p)")
    }
}
