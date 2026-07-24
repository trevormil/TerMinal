import SwiftUI

// Drill-downs. The phone is a READER — everything here is content you'd
// otherwise have to walk to the Mac for. Actions stay in terminal sessions.

/// Loads `T` once and renders it, with consistent loading/error/empty states.
struct DetailLoader<T, Content: View>: View {
    let load: () async throws -> T
    @ViewBuilder let content: (T) -> Content

    @State private var value: T?
    @State private var error: String?

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    } else if let value {
                        content(value)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
            }
            .overlay { if value == nil && error == nil { ProgressView().tint(GT.accentLight) } }
            .refreshable { await refresh() }
        }
        .task { await refresh() }
    }

    private func refresh() async {
        do {
            value = try await load()
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// Monospaced viewer for logs and prompts: horizontally scrollable so long lines
/// aren't wrapped into mush, selectable, and copyable whole.
struct CodeViewer: View {
    let text: String
    let truncated: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if truncated {
                Text("Shown in part — the Mac capped this for the wire.")
                    .font(GT.sans(11))
                    .foregroundStyle(GT.yellow)
            }
            if text.isEmpty {
                Text("Nothing to show.").font(GT.sans(12)).foregroundStyle(GT.textMuted)
            } else {
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                            Text(line.isEmpty ? " " : line)
                                .font(GT.mono(11))
                                .foregroundStyle(GT.textSoft)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(10)
                }
                .background(GT.codeBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .contextMenu {
                    Button("Copy all", systemImage: "doc.on.doc") {
                        UIPasteboard.general.string = text
                    }
                }
            }
        }
    }

    // Cap rendered lines: a 200k-char log would otherwise build a huge view.
    private var lines: [String] {
        let all = text.components(separatedBy: "\n")
        return all.count > 4000 ? Array(all.suffix(4000)) : all
    }

}

private func sectionLabel(_ s: String) -> some View {
    Text(s.uppercased())
        .font(GT.sans(10, .semibold))
        .tracking(0.8)
        .foregroundStyle(GT.textFaint)
}

// ---- ticket --------------------------------------------------------------

struct TicketDetailView: View {
    let client: BridgeClient
    let repo: String
    let slug: String

    var body: some View {
        DetailLoader { try await client.ticket(repo: repo, slug: slug) } content: { t in
            VStack(alignment: .leading, spacing: 14) {
                Text(t.title).font(GT.sans(18, .semibold)).foregroundStyle(GT.text)
                HStack(spacing: 6) {
                    pill(t.status, tint: GT.accent2)
                    pill(t.type, tint: GT.textMuted)
                    if t.priority == "high" { pill("high", tint: GT.yellow) }
                    Text("#\(t.id)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                }
                if let acceptance = t.acceptance, !acceptance.isEmpty {
                    sectionLabel("Acceptance")
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(acceptance.enumerated()), id: \.offset) { _, a in
                            Text("• \(a)").font(GT.sans(13)).foregroundStyle(GT.textSoft)
                        }
                    }
                }
                if let prs = t.prs, !prs.isEmpty {
                    sectionLabel("PRs")
                    ForEach(prs, id: \.self) { p in
                        Text(p).font(GT.mono(11)).foregroundStyle(GT.accentLight)
                            .textSelection(.enabled)
                    }
                }
                sectionLabel("Body")
                MarkdownText(raw: t.body.isEmpty ? "_No body._" : t.body)
            }
        }
        .navigationTitle(slug)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

// ---- PR ------------------------------------------------------------------

struct PrDetailView: View {
    let client: BridgeClient
    let repo: String
    let iid: Int

    /// Fetched up front so the "View diff" link can show files + net ±,
    /// then handed to PrDiffView so it doesn't fetch again.
    @State private var parsedDiff: ParsedDiff?

    var body: some View {
        DetailLoader { try await client.pr(repo: repo, iid: iid) } content: { pr in
            VStack(alignment: .leading, spacing: 14) {
                Text(pr.title).font(GT.sans(18, .semibold)).foregroundStyle(GT.text)
                HStack(spacing: 6) {
                    pill(pr.state, tint: GT.accent2)
                    if pr.draft { pill("draft", tint: GT.yellow) }
                    Text(pr.author).font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    if let b = pr.branch {
                        Text("· \(b)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                            .lineLimit(1)
                    }
                }
                if !pr.labels.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(pr.labels, id: \.self) { pill($0, tint: GT.accentLight) }
                        }
                    }
                }

                // Review verdict + score, front and center — the desktop MRs
                // list's quick-scan signal.
                if pr.verdict != nil || pr.score != nil || pr.testStatus != nil
                    || pr.riskTier != nil || pr.ci != nil {
                    GTPanel(padding: 10) {
                        HStack(alignment: .top, spacing: 16) {
                            if let v = pr.verdict {
                                reviewStat("verdict") {
                                    pill(v, tint: v == "approve" ? GT.green : GT.yellow)
                                }
                            }
                            if let s = pr.score {
                                reviewStat("score") {
                                    Text("\(Int(s))")
                                        .font(GT.mono(17, .medium))
                                        .foregroundStyle(s >= 80 ? GT.green : GT.yellow)
                                }
                            }
                            if let tests = pr.testStatus, !tests.isEmpty {
                                reviewStat("tests") {
                                    pill(tests, tint: tests == "pass" ? GT.green : GT.yellow)
                                }
                            }
                            if let risk = pr.riskTier, !risk.isEmpty {
                                reviewStat("risk") {
                                    pill(risk, tint: risk == "high" ? GT.red : GT.textMuted)
                                }
                            }
                            if let ci = pr.ci, !ci.isEmpty {
                                reviewStat("ci") {
                                    pill(ci, tint: ci == "success" ? GT.green : GT.yellow)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }

                NavigationLink {
                    PrDiffView(client: client, repo: repo, iid: iid, preloaded: parsedDiff)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text.magnifyingglass")
                        Text("View diff")
                        Spacer()
                        if let d = parsedDiff {
                            Text("\(d.files.count) files")
                                .font(GT.sans(11)).foregroundStyle(GT.textMuted)
                            Text("+\(d.additions)").font(GT.mono(11)).foregroundStyle(GT.green)
                            Text("−\(d.deletions)").font(GT.mono(11)).foregroundStyle(GT.red)
                        }
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11)).foregroundStyle(GT.textFaint)
                    }
                    .frame(maxWidth: .infinity)
                    .gtSecondaryButton()
                }
                .buttonStyle(.plain)

                if let findings = pr.findings, !findings.isEmpty {
                    sectionLabel("Findings (\(findings.count))")
                    ForEach(findings) { f in findingPanel(f) }
                }

                if let suggestions = pr.suggestions, !suggestions.isEmpty {
                    sectionLabel("Suggestions (\(suggestions.count))")
                    ForEach(suggestions) { f in findingPanel(f) }
                }

                if !pr.description.isEmpty {
                    sectionLabel("Description")
                    MarkdownText(raw: pr.description)
                }
                if let notes = pr.reviewNotes, !notes.isEmpty {
                    sectionLabel("Code review")
                    MarkdownText(raw: notes)
                }
                if let url = URL(string: pr.url) {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.up.right.square")
                            Text("Open on GitHub")
                        }
                        .frame(maxWidth: .infinity)
                        .gtSecondaryButton()
                    }
                }
            }
        }
        .navigationTitle("!\(iid)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            guard parsedDiff == nil else { return }
            if let text = try? await client.prDiff(repo: repo, iid: iid) {
                parsedDiff = ParsedDiff(
                    files: DiffParser.parse(text.text), truncated: text.truncated)
            }
        }
    }

    @ViewBuilder
    private func reviewStat(_ label: String, @ViewBuilder value: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(GT.sans(9, .semibold)).tracking(0.8).foregroundStyle(GT.textFaint)
            value()
        }
    }

    private func severityTint(_ s: String) -> Color {
        switch s.lowercased() {
        case "high", "critical": return GT.yellow
        case "medium": return GT.accent2
        default: return GT.textMuted
        }
    }

    /// One finding/suggestion card — shared by both sections.
    @ViewBuilder
    private func findingPanel(_ f: WsFinding) -> some View {
        GTPanel(padding: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if let s = f.severity { pill(s, tint: severityTint(s)) }
                    Text(f.title ?? "finding")
                        .font(GT.sans(13, .medium)).foregroundStyle(GT.text)
                }
                if let file = f.file {
                    Text("\(file)\(f.line.map { ":\($0)" } ?? "")")
                        .font(GT.mono(10)).foregroundStyle(GT.textFaint)
                }
                if let t = f.text, !t.isEmpty {
                    Text(t).font(GT.sans(12)).foregroundStyle(GT.textMuted)
                }
            }
        }
    }
}

// ---- run log -------------------------------------------------------------

struct RunDetailView: View {
    let client: BridgeClient
    let run: WsRun

    var body: some View {
        DetailLoader {
            try await client.runLog(id: run.id, source: run.source, hostId: run.hostId)
        } content: { log in
            VStack(alignment: .leading, spacing: 12) {
                Text(run.title).font(GT.sans(17, .semibold)).foregroundStyle(GT.text)
                HStack(spacing: 6) {
                    pill(run.status, tint: run.failed ? GT.yellow : GT.green)
                    Text(run.engine).font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    if !run.branch.isEmpty {
                        Text("· \(run.branch)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                    Text("· \(run.source)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                }
                sectionLabel("Log")
                CodeViewer(text: log.text, truncated: log.truncated)
            }
        }
        .navigationTitle("Run")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

// ---- schedule ------------------------------------------------------------

struct ScheduleDetailView: View {
    let client: BridgeClient
    let repo: String
    let id: String

    var body: some View {
        DetailLoader { try await client.schedule(repo: repo, id: id) } content: { s in
            VStack(alignment: .leading, spacing: 14) {
                Text(s.title).font(GT.sans(18, .semibold)).foregroundStyle(GT.text)
                HStack(spacing: 6) {
                    pill(s.enabled ? "enabled" : "paused", tint: s.enabled ? GT.green : GT.textFaint)
                    Text(s.describe).font(GT.mono(11)).foregroundStyle(GT.textMuted)
                }
                HStack(spacing: 8) {
                    if let e = s.engine {
                        Text(e).font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                    if let m = s.model {
                        Text("· \(m)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                    if let h = s.host {
                        Text("· host \(h)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                    if let r = s.runtime {
                        Text("· \(r)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                }
                if let next = s.nextRun {
                    Text("next run \(relativeTime(next))")
                        .font(GT.sans(12)).foregroundStyle(GT.textSoft)
                }
                sectionLabel("Prompt")
                CodeViewer(text: s.prompt, truncated: false)
            }
        }
        .navigationTitle("Schedule")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}
