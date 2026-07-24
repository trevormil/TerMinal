import SwiftUI

@Observable
final class HealthViewModel {
    let client: BridgeClient
    private(set) var checks: [CheckStatus] = []
    private(set) var error: String?
    var loading = true

    init(client: BridgeClient) { self.client = client }

    /// Worst first, then most recently updated, so the top of the list is
    /// always the thing most worth looking at.
    var ranked: [CheckStatus] { Self.rank(checks) }

    static func rank(_ checks: [CheckStatus]) -> [CheckStatus] {
        checks.sorted { a, b in
            if severity(a.status) != severity(b.status) {
                return severity(a.status) > severity(b.status)
            }
            return a.updatedAt > b.updatedAt
        }
    }

    private static func severity(_ status: String) -> Int {
        switch status {
        case "fail": return 2
        case "warn": return 1
        default: return 0
        }
    }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            checks = try await client.checks()
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// Fleet health at a glance: every check the Mac's scheduled agents report,
/// worst first, with a drill-in for per-item detail. Fully generic — the phone
/// renders whatever shape the checks publish.
struct HealthView: View {
    @State var model: HealthViewModel

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                LazyVStack(spacing: 10) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    if !model.checks.isEmpty {
                        HealthHero(checks: model.checks)
                    }
                    if model.checks.isEmpty && !model.loading {
                        GTPanel {
                            Text(
                                "No checks reporting yet. Schedule a check agent on your Mac (see fleet-health / http-check in the project template)."
                            )
                            .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    }
                    ForEach(model.ranked) { check in
                        NavigationLink(value: check) { CheckRow(check: check) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(14)
            }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
        }
        .navigationTitle("Health")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationDestination(for: CheckStatus.self) { check in
            CheckDetailView(check: check)
        }
        .task {
            // .task cancels when the tab leaves the screen, so this polls only
            // while Health is actually visible.
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }
}

/// The big verdict up top: one colored line summarizing every check.
private struct HealthHero: View {
    let checks: [CheckStatus]

    var body: some View {
        let overall = overallStatus(checks)
        GTPanel(padding: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(headline(overall))
                    .font(GT.sans(22, .semibold))
                    .foregroundStyle(statusColor(overall))
                Text("\(checks.count) check\(checks.count == 1 ? "" : "s") · worst first")
                    .font(GT.mono(11))
                    .foregroundStyle(GT.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func headline(_ overall: String) -> String {
        switch overall {
        case "fail": return "Attention needed"
        case "warn": return "Degraded"
        default: return "All systems go"
        }
    }
}

private struct CheckRow: View {
    let check: CheckStatus

    var body: some View {
        let stale = isStale(check)
        GTPanel {
            HStack(spacing: 10) {
                Circle()
                    .fill(stale ? GT.textFaint : statusColor(check.status))
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(check.isGlobal ? check.kind : "\(check.repoLabel) · \(check.kind)")
                            .font(GT.sans(14, .medium)).foregroundStyle(GT.text).lineLimit(1)
                        if stale { pill("stale", tint: GT.textFaint) }
                    }
                    Text(check.summary)
                        .font(GT.sans(12)).foregroundStyle(GT.textMuted).lineLimit(2)
                }
                Spacer(minLength: 4)
                Text(relativeTime(check.updatedAt))
                    .font(GT.mono(10)).foregroundStyle(GT.textFaint)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(GT.textFaint)
            }
        }
    }
}

/// Everything one check published: summary, metrics, then per-section items.
/// Generic on purpose — no stack-specific rendering, so any check agent's
/// payload shows without app changes.
struct CheckDetailView: View {
    let check: CheckStatus

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    GTPanel {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 8) {
                                Text(check.status.uppercased())
                                    .font(GT.sans(12, .semibold))
                                    .foregroundStyle(statusColor(check.status))
                                if isStale(check) { pill("stale", tint: GT.textFaint) }
                                Spacer()
                                Text("updated \(relativeTime(check.updatedAt))")
                                    .font(GT.mono(10)).foregroundStyle(GT.textFaint)
                            }
                            Text(check.summary).font(GT.sans(13)).foregroundStyle(GT.textSoft)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if let metrics = check.metrics, !metrics.isEmpty {
                        GTPanel {
                            metaLine(metrics)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }

                    ForEach(check.detail?.sections ?? [], id: \.title) { section in
                        Text(section.title.uppercased())
                            .font(GT.sans(10, .semibold))
                            .tracking(0.8)
                            .foregroundStyle(GT.textFaint)
                            .padding(.top, 4)
                        ForEach(section.items, id: \.self) { item in
                            CheckItemRow(item: item)
                        }
                    }
                }
                .padding(14)
            }
        }
        .navigationTitle(check.isGlobal ? check.kind : "\(check.repoLabel) · \(check.kind)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

private struct CheckItemRow: View {
    let item: CheckItem

    var body: some View {
        // A "url" meta value makes the whole row a link out (dashboards, PRs).
        if let raw = item.meta?["url"], let url = URL(string: raw) {
            Link(destination: url) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }

    private var row: some View {
        GTPanel {
            HStack(alignment: .top, spacing: 10) {
                Circle()
                    .fill(statusColor(item.health))
                    .frame(width: 7, height: 7)
                    .padding(.top, 4)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.label).font(GT.sans(13, .medium)).foregroundStyle(GT.text)
                    if let meta = item.meta, !meta.isEmpty {
                        metaLine(meta)
                    }
                }
                Spacer(minLength: 4)
                if item.meta?["url"] != nil {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(GT.textFaint)
                }
            }
        }
    }
}

/// Compact "key value · key value" mono line for heterogeneous meta/metrics.
@ViewBuilder
private func metaLine(_ meta: [String: String]) -> some View {
    Text(
        meta.sorted { $0.key < $1.key }
            .map { "\($0.key) \($0.value)" }
            .joined(separator: "  ·  ")
    )
    .font(GT.mono(10))
    .foregroundStyle(GT.textMuted)
    .lineLimit(3)
}

private func statusColor(_ status: String) -> Color {
    switch status {
    case "ok": return GT.green
    case "warn": return GT.yellow
    case "fail": return GT.red
    default: return GT.textFaint
    }
}
