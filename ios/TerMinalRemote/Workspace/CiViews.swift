import SwiftUI

/// Colour + glyph for a CI status, shared by rows and detail.
private func ciMeta(_ status: String) -> (icon: String, color: Color) {
    switch status {
    case "success": return ("checkmark.circle.fill", GT.green)
    case "failed": return ("xmark.circle.fill", GT.red)
    case "in_progress": return ("arrow.triangle.2.circlepath", GT.accent2)
    case "queued", "pending": return ("clock", GT.yellow)
    default: return ("minus.circle", GT.textFaint)  // canceled / skipped
    }
}

private func ciDuration(_ ms: Double?) -> String {
    guard let ms, ms > 0 else { return "" }
    let s = Int(ms / 1000)
    if s < 60 { return "\(s)s" }
    if s < 3600 { return "\(s / 60)m \(s % 60)s" }
    return "\(s / 3600)h \((s % 3600) / 60)m"
}

private func ciRelative(_ ms: Double) -> String {
    let s = Int(Date().timeIntervalSince1970 - ms / 1000)
    if s < 60 { return "\(s)s" }
    if s < 3600 { return "\(s / 60)m" }
    if s < 86400 { return "\(s / 3600)h" }
    return "\(s / 86400)d"
}

/// One run in the CI list — status, branch/sha, event, timing.
struct CiRunRow: View {
    let run: CiRun
    var body: some View {
        GTPanel(padding: 11) {
            HStack(spacing: 10) {
                let m = ciMeta(run.status)
                Image(systemName: m.icon).font(.system(size: 15)).foregroundStyle(m.color)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.triangle.branch").font(.system(size: 9))
                        Text(run.branch).font(GT.mono(11))
                        Text("· \(run.shortSha)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                    .foregroundStyle(GT.textSoft).lineLimit(1)
                    HStack(spacing: 5) {
                        Text(run.event).font(GT.sans(10)).foregroundStyle(GT.textFaint)
                        Text("· \(ciRelative(run.createdAt)) ago").font(GT.sans(10))
                            .foregroundStyle(GT.textFaint)
                        if !ciDuration(run.durationMs).isEmpty {
                            Text("· \(ciDuration(run.durationMs))").font(GT.sans(10))
                                .foregroundStyle(GT.textFaint)
                        }
                    }
                    .lineLimit(1)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(GT.textFaint)
            }
        }
    }
}

/// A run's jobs (grouped by stage) + an Open-on-forge link. Logs live on the
/// forge — the phone links out rather than shipping a wall of text.
struct CiRunDetailView: View {
    let client: BridgeClient
    let repo: String
    let run: CiRun

    @State private var jobs: [CiJob] = []
    @State private var loading = true
    @State private var error: String?

    private var stages: [(name: String, jobs: [CiJob])] {
        var order: [String] = []
        var map: [String: [CiJob]] = [:]
        for j in jobs {
            if map[j.stage] == nil { order.append(j.stage) }
            map[j.stage, default: []].append(j)
        }
        return order.map { (name: $0, jobs: map[$0] ?? []) }
    }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    header
                    if let error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    ForEach(Array(stages.enumerated()), id: \.offset) { _, stage in
                        if stage.name != "default" && stages.count > 1 {
                            Text(stage.name.uppercased())
                                .font(GT.sans(10, .semibold)).tracking(0.8)
                                .foregroundStyle(GT.textFaint)
                        }
                        ForEach(stage.jobs) { job in CiJobRow(job: job) }
                    }
                    if jobs.isEmpty && !loading {
                        Text("No job detail.").font(GT.sans(12)).foregroundStyle(GT.textMuted)
                    }
                }
                .padding(14)
            }
            .overlay { if loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await load() }
        }
        .navigationTitle(run.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task { await load() }
    }

    private var header: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    let m = ciMeta(run.status)
                    Image(systemName: m.icon).foregroundStyle(m.color)
                    Text(run.status.replacingOccurrences(of: "_", with: " "))
                        .font(GT.sans(14, .medium)).foregroundStyle(GT.text)
                    Spacer()
                    Text(run.branch).font(GT.mono(11)).foregroundStyle(GT.textMuted)
                }
                if let url = URL(string: run.webUrl) {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.up.right.square")
                            Text("Open full logs on \(run.webUrl.contains("gitlab") ? "GitLab" : "GitHub")")
                        }
                        .frame(maxWidth: .infinity)
                        .gtSecondaryButton()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @MainActor private func load() async {
        loading = true
        defer { loading = false }
        do {
            jobs = try await client.ciJobs(repo: repo, runId: run.id)
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// One job, with its GitHub steps as an indented list.
private struct CiJobRow: View {
    let job: CiJob
    @State private var expanded = false
    var body: some View {
        GTPanel(padding: 10) {
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    if job.steps?.isEmpty == false { expanded.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        let m = ciMeta(job.status)
                        Image(systemName: m.icon).font(.system(size: 13)).foregroundStyle(m.color)
                        Text(job.name).font(GT.sans(13, .medium)).foregroundStyle(GT.text)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        if !ciDuration(job.durationMs).isEmpty {
                            Text(ciDuration(job.durationMs)).font(GT.mono(10))
                                .foregroundStyle(GT.textFaint)
                        }
                        if job.steps?.isEmpty == false {
                            Image(systemName: expanded ? "chevron.down" : "chevron.right")
                                .font(.system(size: 10)).foregroundStyle(GT.textFaint)
                        }
                    }
                }
                .buttonStyle(.plain)
                if expanded, let steps = job.steps {
                    ForEach(steps, id: \.number) { step in
                        HStack(spacing: 7) {
                            let m = ciMeta(step.status)
                            Image(systemName: m.icon).font(.system(size: 10)).foregroundStyle(m.color)
                            Text(step.name).font(GT.sans(11)).foregroundStyle(GT.textSoft)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(.leading, 20)
                    }
                }
            }
        }
    }
}
