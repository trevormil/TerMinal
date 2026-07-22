import SwiftUI

struct TicketRow: View {
    let t: WsTicket
    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                Text("#\(t.id)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(t.title)
                        .font(GT.sans(14, .medium))
                        .foregroundStyle(t.isDone ? GT.textMuted : GT.text)
                        .lineLimit(2)
                    HStack(spacing: 6) {
                        pill(t.status, tint: statusTint)
                        Text(t.type).font(GT.mono(10)).foregroundStyle(GT.textFaint)
                        if t.priority == "high" {
                            Text("high").font(GT.mono(10)).foregroundStyle(GT.yellow)
                        }
                        if t.hitl {
                            Image(systemName: "person.fill.questionmark")
                                .font(.system(size: 10)).foregroundStyle(GT.accent2)
                        }
                    }
                }
                Spacer(minLength: 4)
            }
        }
    }
    private var statusTint: Color {
        switch t.status {
        case "in_progress", "in-progress": return GT.accent2
        case "done", "closed": return GT.textFaint
        default: return GT.textMuted
        }
    }
}

struct PrRow: View {
    let pr: WsPr
    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                Image(systemName: pr.draft ? "hammer.circle" : "arrow.triangle.pull")
                    .font(.system(size: 14)).foregroundStyle(pr.draft ? GT.textFaint : GT.accentLight)
                VStack(alignment: .leading, spacing: 3) {
                    Text(pr.title).font(GT.sans(14, .medium)).foregroundStyle(GT.text).lineLimit(2)
                    HStack(spacing: 6) {
                        Text("!\(pr.iid)").font(GT.mono(10)).foregroundStyle(GT.textFaint)
                        if pr.draft { pill("draft", tint: GT.textFaint) }
                        if let v = pr.verdict {
                            pill(v, tint: v == "approve" ? GT.green : GT.yellow)
                        }
                        if let s = pr.score {
                            Text("\(Int(s))").font(GT.mono(10)).foregroundStyle(GT.textFaint)
                        }
                    }
                }
                Spacer(minLength: 4)
            }
        }
    }
}

struct RunRow: View {
    let run: WsRun
    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                GTStatusDot(status: run.isRunning ? "working" : (run.failed ? "ended" : "idle"))
                VStack(alignment: .leading, spacing: 3) {
                    Text(run.title).font(GT.sans(14, .medium)).foregroundStyle(GT.text).lineLimit(1)
                    HStack(spacing: 6) {
                        EngineLogo(engine: run.engine, size: 11)
                        Text(WsEngine.label(for: run.engine))
                            .font(GT.sans(10)).foregroundStyle(GT.textFaint)
                        Text("· \(run.branch)").font(GT.mono(10)).foregroundStyle(GT.textFaint)
                        Text("· \(relativeTime(run.startedAt))")
                            .font(GT.mono(10)).foregroundStyle(GT.textFaint)
                    }
                }
                Spacer(minLength: 4)
                Text(run.status)
                    .font(GT.sans(10, .semibold))
                    .foregroundStyle(run.failed ? GT.yellow : (run.isRunning ? GT.accent2 : GT.green))
            }
        }
    }
}

struct ScheduleRow: View {
    let s: WsSchedule
    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                Image(systemName: "clock")
                    .font(.system(size: 13))
                    .foregroundStyle(s.enabled ? GT.accentLight : GT.textFaint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(s.title).font(GT.sans(14, .medium)).foregroundStyle(GT.text).lineLimit(1)
                    Text(s.describe).font(GT.mono(11)).foregroundStyle(GT.textFaint).lineLimit(1)
                }
                Spacer(minLength: 4)
                if !s.enabled {
                    Text("paused").font(GT.sans(10)).foregroundStyle(GT.textFaint)
                } else if let next = s.nextRun {
                    Text(relativeTime(next)).font(GT.mono(10)).foregroundStyle(GT.textMuted)
                }
            }
        }
    }
}

/// A small status/label capsule.
@ViewBuilder
func pill(_ text: String, tint: Color) -> some View {
    Text(text)
        .font(GT.sans(10, .semibold))
        .foregroundStyle(tint)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(tint.opacity(0.12))
        .clipShape(Capsule())
}

/// Compact relative time from an epoch-millis value ("3m", "2h", "in 5h").
func relativeTime(_ epochMillis: Double) -> String {
    let delta = epochMillis / 1000 - Date().timeIntervalSince1970
    let past = delta < 0
    let secs = abs(delta)
    let out: String
    switch secs {
    case ..<60: out = "\(Int(secs))s"
    case ..<3600: out = "\(Int(secs / 60))m"
    case ..<86400: out = "\(Int(secs / 3600))h"
    default: out = "\(Int(secs / 86400))d"
    }
    return past ? out : "in \(out)"
}
