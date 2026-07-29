import SwiftUI

/// One event from the Mac's global activity feed (`/v1/activity`). The phone is
/// a reader — the desktop owns the full record; we decode just what a row needs.
struct ActivityItem: Decodable, Identifiable, Hashable {
    let id: String
    let ts: Double
    let kind: String
    let title: String
    let detail: String?
    let repo: String?
}

@Observable
final class ActivityViewModel {
    let client: BridgeClient
    private(set) var items: [ActivityItem] = []
    private(set) var error: String?
    var loading = true

    init(client: BridgeClient) { self.client = client }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            items = try await client.activity()
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

/// The global live feed — session starts, tickets, PRs, reviews, test runs,
/// checks, docs, agent runs — newest first. Mirrors the desktop's top-right
/// Activity drawer; read-only. Its own tab, a peer of Inbox.
struct ActivityView: View {
    @State var model: ActivityViewModel

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    if model.items.isEmpty && !model.loading {
                        GTPanel {
                            Text("No activity yet. Session starts, tickets, PRs, reviews, test runs, checks, and agent runs show up here.")
                                .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    }
                    ForEach(model.items) { item in
                        // Chevron lives INSIDE the card (ActivityRow draws it);
                        // the native accessory is suppressed by hiding the link —
                        // same pattern as InboxView's row -> detail push.
                        ActivityRow(item: item)
                            .background(
                                NavigationLink {
                                    ActivityDetailView(item: item)
                                } label: { EmptyView() }
                                .opacity(0)
                            )
                    }
                }
                .padding(14)
            }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
        }
        .navigationTitle("Activity")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            // Poll only while visible (cancels when the screen leaves the stack).
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }
}

/// Render the inline markdown agents write (**bold**, `code`, [links]) rather
/// than showing the raw asterisks. Collapsed to one line and inline-only, so a
/// multi-line body still fits a compact row; falls back to plain text if the
/// markdown doesn't parse.
func inlineMarkdown(_ s: String) -> AttributedString {
    let flat = s.replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: #"^\s*#{1,6}\s+"#, with: "", options: .regularExpression)
    return (try? AttributedString(
        markdown: flat,
        options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
        ?? AttributedString(s)
}

private struct ActivityRow: View {
    let item: ActivityItem

    var body: some View {
        let (symbol, color) = Activity.glyph(item.kind)
        GTPanel {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: 20)
                    .padding(.top, 1)
                VStack(alignment: .leading, spacing: 3) {
                    Text(inlineMarkdown(item.title))
                        .font(GT.sans(13, .medium)).foregroundStyle(GT.text).lineLimit(2)
                    if let detail = item.detail, !detail.isEmpty {
                        Text(inlineMarkdown(detail))
                            .font(GT.sans(11)).foregroundStyle(GT.textMuted).lineLimit(2)
                    }
                    if let repo = item.repo, !repo.isEmpty {
                        Text(repo).font(GT.mono(9)).foregroundStyle(GT.textFaint)
                    }
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(relativeTime(item.ts))
                        .font(GT.mono(9)).foregroundStyle(GT.textFaint)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(GT.textFaint)
                }
            }
        }
    }
}

/// The opened event: full title + detail, never clamped. Same pattern as
/// InboxView's InboxDetailView — a tap always lands here, reading the whole
/// thing, matching the desktop's click-through detail screen.
private struct ActivityDetailView: View {
    let item: ActivityItem

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(inlineMarkdown(item.title))
                        .font(GT.sans(18, .semibold)).foregroundStyle(GT.text)
                    HStack(spacing: 6) {
                        if let repo = item.repo, !repo.isEmpty {
                            Text(repo).font(GT.mono(11)).foregroundStyle(GT.textFaint)
                        }
                        Text(relativeTime(item.ts)).font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                    if let detail = item.detail, !detail.isEmpty {
                        MarkdownText(raw: detail)
                    } else {
                        Text("No details.").font(GT.sans(13)).foregroundStyle(GT.textMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

/// Kind → SF Symbol + tint. Mirrors the desktop feed's icon/tone mapping; any
/// unknown kind falls back to a neutral dot so new kinds still render.
private enum Activity {
    static func glyph(_ kind: String) -> (String, Color) {
        switch kind {
        case "error", "tests-fail": return ("exclamationmark.triangle.fill", GT.red)
        case "blocked": return ("hand.raised.fill", GT.red)
        case "hitl", "question": return ("questionmark.circle.fill", GT.yellow)
        case "task-complete", "tests-pass": return ("checkmark.circle.fill", GT.green)
        case "pr-merged": return ("arrow.triangle.merge", GT.green)
        case "pr-opened", "pr-verdict": return ("arrow.triangle.pull", GT.accentLight)
        case "ticket-filed", "ticket-closed": return ("ticket.fill", GT.accentLight)
        case "deploy": return ("shippingbox.fill", GT.accentLight)
        case "review": return ("magnifyingglass", GT.accentLight)
        case "check": return ("checkmark.seal.fill", GT.accent2)
        case "doc": return ("doc.text.fill", GT.textMuted)
        case "session-start", "session-end": return ("bolt.horizontal.circle.fill", GT.accent2)
        case "agent-run": return ("cpu", GT.accent2)
        default: return ("circle.fill", GT.textMuted)
        }
    }
}
