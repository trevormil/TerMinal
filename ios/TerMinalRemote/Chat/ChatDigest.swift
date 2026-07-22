import Foundation

/// A thread rolled up for reading on a phone.
///
/// The raw transcript is a log: every tool call, every intermediate note. On a
/// phone that is unreadable and mostly noise. A digest keeps what a human
/// actually reads — the prose the agent wrote and what you said — and collapses
/// the work between them into one line you can expand if you care.
enum DigestEntry: Identifiable, Equatable {
    case message(ChatMessage)
    /// Consecutive tool calls, rolled into a single "did 12 things" row.
    case work(id: String, at: Date, steps: [ChatMessage], failed: Int)

    var id: String {
        switch self {
        case .message(let m): return m.id
        case .work(let id, _, _, _): return "work-\(id)"
        }
    }

    var at: Date {
        switch self {
        case .message(let m): return m.at
        case .work(_, let at, _, _): return at
        }
    }
}

enum ChatDigest {
    /// Collapse runs of tool calls. A single tool call stays as-is — rolling up
    /// one thing into "1 step" would be noise, not a summary.
    static func build(_ messages: [ChatMessage], collapseFrom: Int = 2) -> [DigestEntry] {
        var out: [DigestEntry] = []
        var run: [ChatMessage] = []

        func flush() {
            guard !run.isEmpty else { return }
            if run.count < collapseFrom {
                out.append(contentsOf: run.map(DigestEntry.message))
            } else {
                let failed = run.filter {
                    if case .tool(_, _, _, _, let status) = $0 { return status == .error }
                    return false
                }.count
                out.append(
                    .work(id: run[0].id, at: run[0].at, steps: run, failed: failed))
            }
            run = []
        }

        for message in messages {
            if case .tool = message {
                run.append(message)
            } else {
                flush()
                out.append(.message(message))
            }
        }
        flush()
        return out
    }

    /// "7 commands, 4 edits" — what the agent actually did, not how it is named.
    static func summarize(_ steps: [ChatMessage]) -> String {
        var counts: [String: Int] = [:]
        for step in steps {
            guard case .tool(_, _, let name, _, _) = step else { continue }
            counts[verb(for: name), default: 0] += 1
        }
        let parts = counts.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
            .map { "\($0.value) \($0.key)\($0.value == 1 ? "" : "s")" }
        return parts.joined(separator: ", ")
    }

    /// Tool names are engine-specific; the human-readable verb is not.
    private static func verb(for tool: String) -> String {
        switch tool.lowercased() {
        case "bash", "exec_command", "shell": return "command"
        case "edit", "write", "apply_patch", "multiedit", "custom_tool_call": return "edit"
        case "read", "notebookread": return "read"
        case "grep", "glob", "search", "codegraph_search": return "search"
        case "webfetch", "websearch": return "lookup"
        case "task", "agent": return "sub-agent"
        default: return "step"
        }
    }
}
