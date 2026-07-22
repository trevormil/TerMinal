import SwiftUI

/// Renders an agent message as Markdown — bold, italic, inline code, links,
/// and fenced code blocks — without a third-party dependency.
///
/// SwiftUI's `Text(AttributedString(markdown:))` handles inline styling but
/// collapses newlines and cannot lay out a fenced code block. So paragraphs and
/// ``` blocks are split out here; each paragraph is rendered as inline Markdown,
/// each code block as a monospace panel.
struct MarkdownText: View {
    let raw: String
    var textColor: Color = GT.textSoft

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
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
                case .prose(let text):
                    Text(inline(text))
                        .font(GT.sans(14))
                        .foregroundStyle(textColor)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private enum Block {
        case prose(String)
        case code(String)
    }

    /// Split on ``` fences. Even segments are prose, odd are code.
    private var blocks: [Block] {
        let parts = raw.components(separatedBy: "```")
        var out: [Block] = []
        for (i, part) in parts.enumerated() {
            if i.isMultiple(of: 2) {
                let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { out.append(.prose(trimmed)) }
            } else {
                // Drop an optional language tag on the opening fence line.
                var body = part
                if let nl = body.firstIndex(of: "\n") {
                    let firstLine = body[..<nl].trimmingCharacters(in: .whitespaces)
                    if !firstLine.contains(" ") && firstLine.count < 20 {
                        body = String(body[body.index(after: nl)...])
                    }
                }
                out.append(.code(body.trimmingCharacters(in: .newlines)))
            }
        }
        return out.isEmpty ? [.prose(raw)] : out
    }

    /// Inline Markdown for one paragraph. Falls back to plain text if the
    /// parser rejects it, so a stray character never blanks the message.
    private func inline(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}
