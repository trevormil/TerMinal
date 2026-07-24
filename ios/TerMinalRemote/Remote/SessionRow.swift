import SwiftUI

/// A registered session row — status dot, engine logo, repo/branch/msg count.
/// Shared by the workspace Sessions tab.
struct SessionRow: View {
    let session: RemoteSession

    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                GTStatusDot(status: session.status)
                if !session.engine.isEmpty { EngineLogo(engine: session.engine, size: 13) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(session.title)
                        .font(GT.sans(15, .medium))
                        .foregroundStyle(GT.text)
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        if !session.repo.isEmpty { Text(session.repo) }
                        if !session.branch.isEmpty { Text("· \(session.branch)") }
                        Text("· \(session.messages) msg")
                    }
                    .font(GT.mono(11))
                    .foregroundStyle(GT.textFaint)
                    .lineLimit(1)
                }
                Spacer(minLength: 6)
                if session.isAwaiting {
                    Text("asking")
                        .font(GT.sans(10, .semibold))
                        .foregroundStyle(GT.accent2)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(GT.accent2.opacity(0.12))
                        .clipShape(Capsule())
                } else if session.isIdle {
                    Text("idle")
                        .font(GT.sans(10, .semibold))
                        .foregroundStyle(GT.yellow)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(GT.yellow.opacity(0.1))
                        .clipShape(Capsule())
                } else if session.hasEnded {
                    Text("done").font(GT.sans(10)).foregroundStyle(GT.textFaint)
                } else {
                    Text("working").font(GT.sans(10)).foregroundStyle(GT.green.opacity(0.8))
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(GT.textFaint)
            }
        }
    }
}
