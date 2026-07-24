import SwiftUI
import UIKit

/// TerMinal's design tokens, lifted verbatim from the desktop renderer
/// (`src/renderer/src/index.css`). The phone should look like the same product,
/// so these hex values are the single source of truth here — if the desktop
/// palette changes, change it here too rather than eyeballing something close.
enum GT {
    // surfaces
    static let bg = Color(hex: 0x0B0B10)
    static let panel = Color(hex: 0x131318)
    static let panel2 = Color(hex: 0x171720)
    static let elevated = Color(hex: 0x181820)
    static let surfaceHover = Color(hex: 0x1A1A22)
    static let terminalBg = Color(hex: 0x0A0A0F)
    static let codeBg = Color(hex: 0x0C0C11)

    // lines
    static let border = Color(hex: 0x26262E)
    static let borderStrong = Color(hex: 0x3A3A46)

    // type
    static let text = Color(hex: 0xE7E7EE)
    static let textSoft = Color(hex: 0xD4D4DD)
    static let textMuted = Color(hex: 0x8A8A99)
    static let textMutedBright = Color(hex: 0xA1A1AA)
    static let textFaint = Color(hex: 0x6B6B7B)

    // brand + status
    static let accent = Color(hex: 0x7C6EF6)
    static let accentLight = Color(hex: 0xA89EFF)
    static let accent2 = Color(hex: 0x00E0C6)
    static let red = Color(hex: 0xF87171)
    static let yellow = Color(hex: 0xFBBF24)
    static let green = Color(hex: 0x4ADE80)
    static let blue = Color(hex: 0x60A5FA)

    /// The one brand flourish — the logo's teal → violet gradient.
    static let gradient = LinearGradient(
        colors: [accent2, accent],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    // IBM Plex — the same pairing the desktop uses: Sans for chrome, Mono for
    // anything that must align or read as code. Vendored as TTF under the OFL
    // because node_modules ships woff only, which iOS cannot load.
    //
    // Falls back to the system face if a font ever fails to register, so a
    // packaging mistake degrades instead of rendering nothing.
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        // PostScript names, NOT filenames — IBM abbreviates them, and a wrong
        // name here fails silently back to the system face.
        case .semibold, .bold, .heavy, .black: name = "IBMPlexSans-SmBld"
        case .medium: name = "IBMPlexSans-Medm"
        default: name = "IBMPlexSans"
        }
        return registered(name) ? .custom(name, size: size) : .system(size: size, weight: weight)
    }

    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name = weight == .regular ? "IBMPlexMono" : "IBMPlexMono-Medm"
        return registered(name)
            ? .custom(name, size: size)
            : .system(size: size, weight: weight, design: .monospaced)
    }

    /// Every PostScript name this theme asks for. Pinned by a test, because a
    /// mismatch degrades silently rather than failing.
    static let fontNames = [
        "IBMPlexSans", "IBMPlexSans-Medm", "IBMPlexSans-SmBld",
        "IBMPlexMono", "IBMPlexMono-Medm",
    ]

    static func registered(_ name: String) -> Bool {
        UIFont(name: name, size: 12) != nil
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// A bordered panel — the desktop's `rounded-xl border bg-panel/55` idiom.
struct GTPanel<Content: View>: View {
    var padding: CGFloat = 12
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .background(GT.panel.opacity(0.55))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12).stroke(GT.border, lineWidth: 1)
            )
    }
}

/// Status dot matching the desktop's session indicators.
struct GTStatusDot: View {
    let status: String
    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .overlay(Circle().stroke(color.opacity(0.35), lineWidth: 3).scaleEffect(1.6))
    }
    private var color: Color {
        switch status {
        case "working": return GT.green
        case "awaiting": return GT.accent2
        case "idle": return GT.yellow
        case "error", "failed": return GT.red
        default: return GT.textFaint
        }
    }
}

extension View {
    /// Standard secondary button chrome (matches SettingsPanel's actionButton).
    func gtSecondaryButton() -> some View {
        self
            .font(GT.sans(13, .medium))
            .foregroundStyle(GT.textSoft)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(Color.black.opacity(0.25))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(GT.border, lineWidth: 1))
    }
}

extension View {
    /// List-row reset for GTPanel-styled rows living inside a native List
    /// (which we use for swipe actions): no system background, no separator,
    /// insets matching the old LazyVStack padding.
    func plainRow() -> some View {
        self
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 5, leading: 14, bottom: 5, trailing: 14))
    }
}
