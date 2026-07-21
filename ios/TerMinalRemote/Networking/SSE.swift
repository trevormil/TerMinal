import Foundation

/// One decoded server-sent event.
struct SSEEvent: Equatable {
    let name: String
    let data: String
}

/// Line-oriented SSE decoder.
///
/// Deliberately a value type driven one line at a time: the transport
/// (`URLSession.bytes(for:).lines`) already handles chunk boundaries, and
/// keeping the parse pure makes every framing case testable without a socket.
struct SSEParser {
    private var name = ""
    private var data: [String] = []

    /// Feed one line. Returns an event when the line terminates a frame.
    mutating func push(_ line: String) -> SSEEvent? {
        if line.isEmpty {
            defer {
                name = ""
                data = []
            }
            guard !name.isEmpty || !data.isEmpty else { return nil }
            return SSEEvent(name: name, data: data.joined(separator: "\n"))
        }
        // Comments (": keepalive") carry no data and must not open a frame.
        if line.hasPrefix(":") { return nil }

        let field: String
        let value: String
        if let colon = line.firstIndex(of: ":") {
            field = String(line[line.startIndex..<colon])
            var rest = line[line.index(after: colon)...]
            if rest.hasPrefix(" ") { rest = rest.dropFirst() }
            value = String(rest)
        } else {
            field = line
            value = ""
        }

        switch field {
        case "event": name = value
        case "data": data.append(value)
        default: break  // id/retry are unused by this protocol
        }
        return nil
    }
}

/// A decoded message from a session stream.
enum TerminalEvent: Equatable {
    /// Opening frame: the desktop's geometry plus enough scrollback to land on
    /// the current screen.
    case hello(cols: Int, rows: Int, name: String, replay: Data)
    case output(Data)
    case exit(code: Int)

    private struct Hello: Decodable {
        let cols: Int
        let rows: Int
        let name: String
        let replay: String
    }
    private struct Exit: Decodable { let code: Int }

    /// Map an SSE frame onto the bridge's protocol. Unknown events decode to
    /// nil so a newer Mac can add frames without breaking an older client.
    static func from(_ event: SSEEvent) -> TerminalEvent? {
        switch event.name {
        case "hello":
            guard let raw = event.data.data(using: .utf8),
                  let hello = try? JSONDecoder().decode(Hello.self, from: raw)
            else { return nil }
            return .hello(
                cols: hello.cols,
                rows: hello.rows,
                name: hello.name,
                replay: Data(base64Encoded: hello.replay) ?? Data()
            )
        case "data":
            guard let bytes = Data(base64Encoded: event.data) else { return nil }
            return .output(bytes)
        case "exit":
            guard let raw = event.data.data(using: .utf8),
                  let exit = try? JSONDecoder().decode(Exit.self, from: raw)
            else { return nil }
            return .exit(code: exit.code)
        default:
            return nil
        }
    }
}
