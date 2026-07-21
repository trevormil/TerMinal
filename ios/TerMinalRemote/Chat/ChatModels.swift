import Foundation

/// One entry in a session's conversation. Mirrors `ChatMessage` in
/// `src/main/chat/messages.ts` — the two must stay in lockstep.
enum ChatMessage: Identifiable, Equatable {
    case user(id: String, at: Date, text: String)
    case assistant(id: String, at: Date, text: String)
    case tool(id: String, at: Date, name: String, summary: String, status: ToolStatus)
    case notice(id: String, at: Date, text: String)

    enum ToolStatus: String, Codable {
        case running, ok, error
    }

    var id: String {
        switch self {
        case .user(let id, _, _), .assistant(let id, _, _),
            .tool(let id, _, _, _, _), .notice(let id, _, _):
            return id
        }
    }

    var at: Date {
        switch self {
        case .user(_, let at, _), .assistant(_, let at, _),
            .tool(_, let at, _, _, _), .notice(_, let at, _):
            return at
        }
    }

    /// Decoded from the wire shape, which is a tagged union on `kind`.
    private struct Wire: Decodable {
        let kind: String
        let at: Double
        let text: String?
        let name: String?
        let summary: String?
        let status: String?
    }

    /// `index` makes the id stable and unique: the bridge sends messages in
    /// order and the phone appends, so position is the natural identity.
    static func decode(_ data: Data, startIndex: Int) throws -> [ChatMessage] {
        struct Envelope: Decodable {
            let messages: [Wire]
            let unsupported: Bool
            let total: Int
        }
        let env = try JSONDecoder().decode(Envelope.self, from: data)
        return env.messages.enumerated().compactMap { offset, w in
            let id = "\(startIndex + offset)"
            // `at` is epoch millis for real timestamps, but the Mac falls back
            // to a line counter when a transcript line has none.
            let date = Date(timeIntervalSince1970: w.at > 1_000_000_000 ? w.at / 1000 : 0)
            switch w.kind {
            case "user": return .user(id: id, at: date, text: w.text ?? "")
            case "assistant": return .assistant(id: id, at: date, text: w.text ?? "")
            case "tool":
                return .tool(
                    id: id, at: date,
                    name: w.name ?? "tool",
                    summary: w.summary ?? "",
                    status: ToolStatus(rawValue: w.status ?? "ok") ?? .ok
                )
            case "notice": return .notice(id: id, at: date, text: w.text ?? "")
            default: return nil  // a newer Mac may add kinds; skip, don't fail
            }
        }
    }
}

struct ChatTranscriptPage {
    let messages: [ChatMessage]
    let unsupported: Bool
    let total: Int
    let status: String
}

/// A thread in the chat list: one live session.
struct ChatThread: Codable, Identifiable, Hashable {
    let key: String
    let name: String
    let repo: String
    let branch: String
    let engine: String
    let status: String
    /// The agent finished its turn and is waiting on a human.
    let needsInput: Bool
    /// False when this engine has no transcript adapter — offer the terminal.
    let chat: Bool

    var id: String { key }
}

/// A human-in-the-loop item — the "agent is blocked on you" queue.
struct HitlItem: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String?
    let action: String?
    let repo: String?
    let source: String
    let createdAt: Double
    let sessionId: String?
    let terminalKey: String?
}

struct RepoOption: Codable, Identifiable, Hashable {
    let name: String
    let path: String
    var id: String { path }
}
