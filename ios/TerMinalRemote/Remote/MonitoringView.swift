import SwiftUI

@Observable
final class MonitoringViewModel {
    let client: BridgeClient
    private(set) var monitors: [MonitorWithState] = []
    private(set) var error: String?
    var loading = true

    init(client: BridgeClient) { self.client = client }

    /// Failing monitors — drives the tab badge.
    var failingCount: Int { monitors.filter { $0.state?.status == "fail" }.count }

    /// Monitors bucketed by `group`, worst group first, worst monitor first
    /// within each — so the top of the screen is always the thing worth looking
    /// at. Monitors without a group fall under "Other".
    var grouped: [(group: String, monitors: [MonitorWithState])] {
        Self.group(monitors)
    }

    static func group(_ monitors: [MonitorWithState]) -> [(group: String, monitors: [MonitorWithState])] {
        var buckets: [String: [MonitorWithState]] = [:]
        for m in monitors {
            buckets[m.group ?? "Other", default: []].append(m)
        }
        return buckets
            .map { (group: $0.key, monitors: rank($0.value)) }
            .sorted { a, b in
                let sa = a.monitors.first.map { severity($0.state?.status) } ?? -1
                let sb = b.monitors.first.map { severity($0.state?.status) } ?? -1
                if sa != sb { return sa > sb }
                return a.group < b.group
            }
    }

    static func rank(_ monitors: [MonitorWithState]) -> [MonitorWithState] {
        monitors.sorted { a, b in
            let sa = severity(a.state?.status)
            let sb = severity(b.state?.status)
            if sa != sb { return sa > sb }
            return (a.state?.lastCheckedAt ?? 0) > (b.state?.lastCheckedAt ?? 0)
        }
    }

    /// nil state (never probed) sorts below ok — it's pending, not healthy.
    private static func severity(_ status: String?) -> Int {
        switch status {
        case "fail": return 3
        case "warn": return 2
        case "ok": return 1
        default: return 0
        }
    }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            monitors = try await client.monitors()
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// Infrastructure at a glance: every monitor the Mac's daemon probes, grouped
/// and worst-first, with a drill-in for per-monitor config, metrics, and detail.
/// Read-only — monitors are added and edited in TerMinal on the Mac.
struct MonitoringView: View {
    @State var model: MonitoringViewModel

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    if !model.monitors.isEmpty {
                        MonitoringHero(monitors: model.monitors)
                    }
                    if model.monitors.isEmpty && !model.loading {
                        GTPanel {
                            Text(
                                "No monitors yet. Add them in TerMinal on your Mac (Monitoring tab)."
                            )
                            .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    }
                    ForEach(model.grouped, id: \.group) { bucket in
                        Text(bucket.group.uppercased())
                            .font(GT.sans(10, .semibold))
                            .tracking(0.8)
                            .foregroundStyle(GT.textFaint)
                            .padding(.top, 4)
                        ForEach(bucket.monitors) { monitor in
                            NavigationLink(value: monitor) { MonitorRow(monitor: monitor) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                .padding(14)
            }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
        }
        .navigationTitle("Monitoring")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationDestination(for: MonitorWithState.self) { monitor in
            MonitorDetailView(monitor: monitor)
        }
        .task {
            // .task cancels when the tab leaves the screen, so this polls only
            // while Monitoring is actually visible.
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }
}

/// The big verdict up top: one colored line summarizing every monitor.
private struct MonitoringHero: View {
    let monitors: [MonitorWithState]

    var body: some View {
        let overall = overallStatus(monitors)
        GTPanel(padding: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(headline(overall))
                    .font(GT.sans(22, .semibold))
                    .foregroundStyle(statusColor(overall))
                Text("\(monitors.count) monitor\(monitors.count == 1 ? "" : "s") · worst first")
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

private struct MonitorRow: View {
    let monitor: MonitorWithState

    var body: some View {
        let stale = isStale(monitor)
        GTPanel {
            HStack(spacing: 10) {
                Circle()
                    .fill(monitor.state == nil ? GT.textFaint : statusColor(monitor.state?.status))
                    .frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(monitor.name)
                            .font(GT.sans(14, .medium)).foregroundStyle(GT.text).lineLimit(1)
                        if stale { pill("stale", tint: GT.textFaint) }
                    }
                    Text("\(monitor.type) · \(monitor.target)")
                        .font(GT.mono(10)).foregroundStyle(GT.textMuted).lineLimit(1)
                    if let summary = monitor.state?.summary {
                        Text(summary)
                            .font(GT.sans(12)).foregroundStyle(GT.textMuted).lineLimit(2)
                    }
                }
                Spacer(minLength: 4)
                if let checkedAt = monitor.state?.lastCheckedAt {
                    Text(relativeTime(checkedAt))
                        .font(GT.mono(10)).foregroundStyle(GT.textFaint)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(GT.textFaint)
            }
        }
    }
}

/// Everything one monitor holds: config, notify prefs, latest metrics, a history
/// strip, then per-section detail. Generic on purpose — no type-specific
/// rendering, so any monitor kind shows without app changes.
struct MonitorDetailView: View {
    let monitor: MonitorWithState

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    statusPanel
                    configPanel
                    notifyPanel
                    if let metrics = monitor.state?.metrics, !metrics.isEmpty {
                        section("Metrics") {
                            GTPanel { metaLine(metrics).frame(maxWidth: .infinity, alignment: .leading) }
                        }
                    }
                    if let history = monitor.state?.history, !history.isEmpty {
                        section("History") { HistoryStrip(history: history) }
                    }
                    ForEach(monitor.state?.detail?.sections ?? [], id: \.title) { s in
                        section(s.title) {
                            ForEach(s.items, id: \.self) { item in MonitorItemRow(item: item) }
                        }
                    }
                }
                .padding(14)
            }
        }
        .navigationTitle(monitor.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    private var statusPanel: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text((monitor.state?.status ?? "pending").uppercased())
                        .font(GT.sans(12, .semibold))
                        .foregroundStyle(monitor.state == nil ? GT.textFaint : statusColor(monitor.state?.status))
                    if isStale(monitor) { pill("stale", tint: GT.textFaint) }
                    Spacer()
                    if let checkedAt = monitor.state?.lastCheckedAt {
                        Text("checked \(relativeTime(checkedAt))")
                            .font(GT.mono(10)).foregroundStyle(GT.textFaint)
                    }
                }
                Text(monitor.state?.summary ?? "No checks reported yet.")
                    .font(GT.sans(13)).foregroundStyle(GT.textSoft)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var configPanel: some View {
        section("Config") {
            GTPanel {
                VStack(alignment: .leading, spacing: 4) {
                    kv("type", monitor.type)
                    kv("target", monitor.target)
                    kv("interval", "\(monitor.intervalSec)s")
                    kv("enabled", monitor.enabled ? "yes" : "no")
                    if !monitor.config.isEmpty {
                        metaLine(monitor.config)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var notifyPanel: some View {
        section("Notify") {
            GTPanel {
                VStack(alignment: .leading, spacing: 4) {
                    kv("on failure", monitor.notify.onFailure)
                    kv("on recovery", monitor.notify.onRecovery ? "yes" : "no")
                    kv("renotify", monitor.notify.renotifyAfterSec == 0
                        ? "once" : "every \(monitor.notify.renotifyAfterSec)s")
                    kv("daily digest", monitor.notify.dailyDigest
                        ? "at \(monitor.notify.digestHour):00" : "off")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// A thin timeline of recent check outcomes, oldest → newest.
private struct HistoryStrip: View {
    let history: [MonitorHistoryPoint]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(history.enumerated()), id: \.offset) { _, point in
                RoundedRectangle(cornerRadius: 2)
                    .fill(statusColor(point.status))
                    .frame(height: 18)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

private struct MonitorItemRow: View {
    let item: MonitorItem

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

/// A titled block: small uppercased caption over its content.
@ViewBuilder
private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    Text(title.uppercased())
        .font(GT.sans(10, .semibold))
        .tracking(0.8)
        .foregroundStyle(GT.textFaint)
        .padding(.top, 4)
    content()
}

/// One "key   value" line, key muted-mono and value soft.
@ViewBuilder
private func kv(_ key: String, _ value: String) -> some View {
    HStack(alignment: .top, spacing: 8) {
        Text(key).font(GT.mono(11)).foregroundStyle(GT.textFaint)
        Spacer(minLength: 8)
        Text(value).font(GT.mono(11)).foregroundStyle(GT.textSoft)
            .multilineTextAlignment(.trailing)
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

private func statusColor(_ status: String?) -> Color {
    switch status {
    case "ok": return GT.green
    case "warn": return GT.yellow
    case "fail": return GT.red
    default: return GT.textFaint
    }
}
