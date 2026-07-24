import Foundation

/// Type-erases an `Encodable` so one `post(_:body:)` can take any request body
/// without a generic parameter leaking into every call site.
struct AnyEncodable: Encodable {
    private let encodeTo: (Encoder) throws -> Void

    init(_ wrapped: any Encodable) {
        encodeTo = { encoder in try wrapped.encode(to: encoder) }
    }

    func encode(to encoder: Encoder) throws {
        try encodeTo(encoder)
    }
}
