import SwiftUI

/// An engine the Mac can launch. Labels come from the Mac (`/v1/engines`) so
/// they match the desktop exactly — the phone must never render a bare
/// lowercase "codex".
struct WsEngine: Codable, Identifiable, Hashable {
    let id: String
    let label: String
}

extension WsEngine {
    /// Fallback list matching the desktop's SESSION_ENGINE_LABEL, used only if
    /// the Mac is too old to serve /v1/engines.
    static let fallback: [WsEngine] = [
        .init(id: "claude", label: "Claude"),
        .init(id: "codex", label: "Codex"),
        .init(id: "cursor", label: "Cursor"),
        .init(id: "openrouter", label: "OpenRouter"),
        .init(id: "hermes", label: "Hermes"),
        .init(id: "openai-compat", label: "Self-hosted"),
        .init(id: "local", label: "Local"),
    ]

    /// Display label for an arbitrary engine id (e.g. one stored on a session).
    static func label(for id: String) -> String {
        fallback.first { $0.id == id }?.label ?? id.capitalized
    }
}

/// The engine's wordmark, mirroring the desktop's EngineLogo: bundled art where
/// a wordmark exists, an SF Symbol where it doesn't (OpenRouter / self-hosted /
/// local ship none).
struct EngineLogo: View {
    let engine: String
    var size: CGFloat = 13

    var body: some View {
        switch engine {
        case "claude": asset("engine-claude")
        case "codex": asset("engine-openai")
        case "cursor": asset("engine-cursor")
        case "hermes": asset("engine-hermes")
        case "openrouter": symbol("point.3.connected.trianglepath.dotted")
        case "openai-compat": symbol("server.rack")
        case "local": symbol("terminal")
        default: symbol("cpu")
        }
    }

    private func asset(_ name: String) -> some View {
        Image(name)
            .resizable()
            .renderingMode(.original)
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
    }

    private func symbol(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: size * 0.92))
            .foregroundStyle(GT.textMuted)
            .frame(width: size, height: size)
    }
}
