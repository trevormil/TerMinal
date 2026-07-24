import Darwin
import SwiftUI

/// Best-effort, on-device check of whether the phone can reach the Mac over the
/// tailnet BEFORE the user tries to pair — so a "connect Tailscale first" is a
/// clear banner, not a mystery timeout.
///
/// We look at the phone's own interface addresses (getifaddrs, no permission
/// needed): a tailnet IP is the same range the Mac's /v1/pair gate accepts —
/// 100.64.0.0/10 (CGNAT) or fd7a:115c:a1e0::/48 (Tailscale ULA). A tunnel
/// interface without a tailnet IP means some OTHER VPN is up, which can capture
/// the traffic and block pairing.
enum TunnelStatus {
    enum State: Equatable {
        case tailscale  // a tailnet address is assigned — Tailscale is up
        case otherVPN  // a VPN/tunnel is up, but it isn't Tailscale
        case none  // no VPN/tunnel detected
    }

    /// True for a Tailscale tailnet address (mirrors the Mac's isTailscaleIp).
    static func isTailnetIP(_ ip: String) -> Bool {
        let clean = ip.replacingOccurrences(of: "%", with: " ").split(separator: " ").first.map(String.init) ?? ip
        let lower = clean.lowercased()
        if lower.hasPrefix("fd7a:115c:a1e0:") { return true }
        let octets = clean.split(separator: ".")
        if octets.count == 4, let a = Int(octets[0]), let b = Int(octets[1]) {
            return a == 100 && b >= 64 && b <= 127
        }
        return false
    }

    static func detect() -> State {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let start = head else { return .none }
        defer { freeifaddrs(head) }

        var hasTailnet = false
        var hasTunnel = false
        var cur: UnsafeMutablePointer<ifaddrs>? = start
        while let ptr = cur {
            let ifa = ptr.pointee
            cur = ifa.ifa_next
            let name = String(cString: ifa.ifa_name)
            let flags = Int32(ifa.ifa_flags)
            let up = (flags & IFF_UP) != 0 && (flags & IFF_RUNNING) != 0
            let isTunnelIface =
                name.hasPrefix("utun") || name.hasPrefix("ipsec") || name.hasPrefix("ppp")
                || name.hasPrefix("tap") || name.hasPrefix("tun")
            if up && isTunnelIface { hasTunnel = true }

            guard let sa = ifa.ifa_addr else { continue }
            let fam = sa.pointee.sa_family
            guard fam == UInt8(AF_INET) || fam == UInt8(AF_INET6) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(
                sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0,
                NI_NUMERICHOST) == 0
            {
                if isTailnetIP(String(cString: host)) { hasTailnet = true }
            }
        }
        if hasTailnet { return .tailscale }
        if hasTunnel { return .otherVPN }
        return .none
    }
}

/// A colored status line for the Tailscale pairing sheet. Re-checks itself on
/// appear and each time the app returns to the foreground (so toggling Tailscale
/// in its own app updates this the moment you switch back).
struct TailscaleStatusBanner: View {
    @State private var status: TunnelStatus.State = .none
    @Environment(\.scenePhase) private var scenePhase

    private var content: (icon: String, tint: Color, text: String) {
        switch status {
        case .tailscale:
            return (
                "checkmark.circle.fill", GT.green,
                "Tailscale looks connected — pairing should work."
            )
        case .otherVPN:
            return (
                "exclamationmark.triangle.fill", GT.yellow,
                "A VPN is on, but it isn't Tailscale — it may block pairing. "
                    + "Connect Tailscale (same account as your Mac)."
            )
        case .none:
            return (
                "bolt.slash.fill", GT.yellow,
                "Tailscale doesn't look connected. Open the Tailscale app and turn "
                    + "it on, or you'll get a timeout."
            )
        }
    }

    var body: some View {
        let c = content
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: c.icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(c.tint)
                .padding(.top, 1)
            Text(c.text).font(GT.sans(12)).foregroundStyle(GT.textSoft)
            Spacer(minLength: 0)
        }
        .padding(11)
        .background(c.tint.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(c.tint.opacity(0.35), lineWidth: 1))
        .onAppear { status = TunnelStatus.detect() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { status = TunnelStatus.detect() }
        }
    }
}
