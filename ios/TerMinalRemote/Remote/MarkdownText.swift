import SwiftUI

/// Renders an agent message as Markdown — headings, paragraphs, bullets, bold,
/// italic, inline code, links, and fenced code blocks — without a third-party
/// dependency.
///
/// Structure is parsed HERE rather than handed to the Markdown parser whole.
/// `AttributedString(markdown:)` follows Markdown's soft-break rule and folds a
/// single newline into a space, which turned every message into one long
/// paragraph. So we split into blocks (blank line = paragraph, `#` = heading,
/// ``` = code) and only use the parser for INLINE styling within a line.
struct MarkdownText: View {
    let raw: String
    var textColor: Color = GT.textSoft

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .code(let code):
                    Text(code)
                        .font(GT.mono(12))
                        .foregroundStyle(GT.textSoft)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(GT.codeBg)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .textSelection(.enabled)
                case .heading(let text):
                    Text(attributed(text))
                        .font(GT.sans(15, .semibold))
                        .foregroundStyle(GT.text)
                        .textSelection(.enabled)
                case .prose(let text):
                    Text(attributed(text))
                        .font(GT.sans(14))
                        .foregroundStyle(textColor)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private enum Block {
        case prose(String)
        case heading(String)
        case code(String)
    }

    /// Split on ``` fences (even segments prose, odd code), then break the prose
    /// into headings and blank-line-separated paragraphs.
    private var blocks: [Block] {
        var out: [Block] = []
        for (i, part) in raw.components(separatedBy: "```").enumerated() {
            if i.isMultiple(of: 2) {
                out.append(contentsOf: proseBlocks(part))
            } else {
                out.append(.code(codeBody(part)))
            }
        }
        return out.isEmpty ? [.prose(raw)] : out
    }

    private func proseBlocks(_ segment: String) -> [Block] {
        var out: [Block] = []
        var buffer: [String] = []
        func flush() {
            let joined = buffer.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !joined.isEmpty { out.append(.prose(joined)) }
            buffer.removeAll()
        }
        for line in segment.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flush()
            } else if let hash = trimmed.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
                flush()
                out.append(.heading(String(trimmed[hash.upperBound...])))
            } else {
                buffer.append(bulletized(line))
            }
        }
        flush()
        return out
    }

    /// Drop an optional language tag on the opening fence line.
    private func codeBody(_ part: String) -> String {
        var body = part
        if let nl = body.firstIndex(of: "\n") {
            let first = body[..<nl].trimmingCharacters(in: .whitespaces)
            if !first.contains(" ") && first.count < 20 {
                body = String(body[body.index(after: nl)...])
            }
        }
        return body.trimmingCharacters(in: .newlines)
    }

    /// `- item` / `* item` → `• item`, keeping any indent.
    private func bulletized(_ line: String) -> String {
        guard let m = line.range(of: #"^(\s*)[-*]\s+"#, options: .regularExpression) else {
            return line
        }
        let indent = line[..<m.lowerBound] + String(repeating: " ", count: 0)
        return "\(indent)• \(line[m.upperBound...])"
    }

    /// Inline Markdown per LINE, rejoined with real newlines so line breaks
    /// survive. Falls back to plain text so a stray character never blanks a
    /// message.
    private func attributed(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace)
        var out = AttributedString()
        for (i, line) in text.components(separatedBy: "\n").enumerated() {
            if i > 0 { out.append(AttributedString("\n")) }
            out.append((try? AttributedString(markdown: line, options: options)) ?? AttributedString(line))
        }
        return out
    }
}
