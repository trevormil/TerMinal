import SwiftUI

/// The keys an agent TUI needs that a phone's software keyboard doesn't offer.
/// Everything here is just bytes on the wire — Ctrl-C really is 0x03, so it
/// interrupts the agent exactly as it would on the desktop.
struct KeyBar: View {
    let send: (Data) -> Void

    private struct Key: Identifiable {
        let id = UUID()
        let label: String
        let bytes: [UInt8]
        var wide = false
    }

    private let keys: [Key] = [
        Key(label: "esc", bytes: [0x1B]),
        Key(label: "^C", bytes: [0x03]),
        Key(label: "^D", bytes: [0x04]),
        Key(label: "tab", bytes: [0x09]),
        Key(label: "↑", bytes: [0x1B, 0x5B, 0x41]),
        Key(label: "↓", bytes: [0x1B, 0x5B, 0x42]),
        Key(label: "←", bytes: [0x1B, 0x5B, 0x44]),
        Key(label: "→", bytes: [0x1B, 0x5B, 0x43]),
        Key(label: "⏎", bytes: [0x0D], wide: true),
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(keys) { key in
                    Button {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        send(Data(key.bytes))
                    } label: {
                        Text(key.label)
                            .font(.system(size: 13, weight: .medium, design: .monospaced))
                            .frame(minWidth: key.wide ? 56 : 40, minHeight: 34)
                            .background(Color.white.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 7))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white)
                    .accessibilityLabel(accessibilityName(for: key.label))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .background(.black)
    }

    private func accessibilityName(for label: String) -> String {
        switch label {
        case "esc": return "Escape"
        case "^C": return "Control C, interrupt"
        case "^D": return "Control D, end of file"
        case "tab": return "Tab"
        case "↑": return "Up arrow"
        case "↓": return "Down arrow"
        case "←": return "Left arrow"
        case "→": return "Right arrow"
        case "⏎": return "Return"
        default: return label
        }
    }
}
