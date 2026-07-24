import CryptoKit
import XCTest

@testable import TerMinalRemote

final class PinnedTrustTests: XCTestCase {
    /// The fingerprint the app computes must equal what the Mac advertises.
    /// The Mac computes base64(SHA-256(DER)) in src/main/bridge/identity.ts —
    /// if these two ever disagree, no device can connect to any Mac.
    func testFingerprintIsBase64SHA256OfTheDER() {
        let der = Data([0x30, 0x82, 0x01, 0x0A, 0xDE, 0xAD, 0xBE, 0xEF])
        let expected = Data(SHA256.hash(data: der)).base64EncodedString()
        XCTAssertEqual(PinnedTrust.fingerprint(ofDER: der), expected)
    }

    func testFingerprintIsStableAndDistinct() {
        let a = Data([0x01, 0x02, 0x03])
        let b = Data([0x01, 0x02, 0x04])
        XCTAssertEqual(PinnedTrust.fingerprint(ofDER: a), PinnedTrust.fingerprint(ofDER: a))
        XCTAssertNotEqual(PinnedTrust.fingerprint(ofDER: a), PinnedTrust.fingerprint(ofDER: b))
    }

    func testFingerprintMatchesAKnownVector() {
        // base64(SHA-256("")) — pins the exact digest+encoding combination, so a
        // change to either (hex, or SHA-1) fails here rather than in the field.
        XCTAssertEqual(
            PinnedTrust.fingerprint(ofDER: Data()),
            "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=")
    }

    /// An empty pin must never be treated as "trust anything" — that would turn
    /// a malformed pairing code into a silently unauthenticated connection.
    func testEmptyPinRejectsEvenAValidTrust() throws {
        let trust = try Self.selfSignedTrust()
        XCTAssertFalse(PinnedTrust.matches(trust: trust, fingerprint: ""))
    }

    func testAcceptsTheMatchingCertificateAndRejectsOthers() throws {
        let (trust, der) = try Self.selfSignedTrustWithDER()
        let correct = PinnedTrust.fingerprint(ofDER: der)

        XCTAssertTrue(PinnedTrust.matches(trust: trust, fingerprint: correct))
        XCTAssertFalse(
            PinnedTrust.matches(
                trust: trust, fingerprint: PinnedTrust.fingerprint(ofDER: Data([0x00]))))
        // A near-miss (one character off) must fail like any other mismatch.
        XCTAssertFalse(PinnedTrust.matches(trust: trust, fingerprint: String(correct.dropLast())))
    }

    // MARK: - fixtures

    /// A DER certificate checked into the test bundle would rot; generating one
    /// here keeps the test self-contained. This is a throwaway self-signed cert
    /// in the same shape the bridge serves.
    private static func selfSignedTrustWithDER() throws -> (SecTrust, Data) {
        guard let cert = SecCertificateCreateWithData(nil, Self.sampleDER as CFData) else {
            throw XCTSkip("could not build the sample certificate")
        }
        var trust: SecTrust?
        let status = SecTrustCreateWithCertificates(
            cert, SecPolicyCreateBasicX509(), &trust)
        guard status == errSecSuccess, let trust else {
            throw XCTSkip("could not build a SecTrust (status \(status))")
        }
        return (trust, SecCertificateCopyData(cert) as Data)
    }

    private static func selfSignedTrust() throws -> SecTrust {
        try selfSignedTrustWithDER().0
    }

    /// A minimal self-signed X.509 certificate (CN=TerMinal), DER encoded.
    /// Generated once with `openssl req -x509 -newkey rsa:2048 -nodes -subj
    /// /CN=TerMinal -days 36500 -outform der`; its only job is to be a real
    /// certificate SecCertificate will accept.
    private static let sampleDER: Data = Data(
        base64Encoded: SampleCertificate.der.replacingOccurrences(of: "\n", with: ""))!
}
