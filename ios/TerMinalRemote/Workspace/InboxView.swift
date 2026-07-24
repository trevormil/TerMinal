import SwiftUI
import UserNotifications

@Observable
final class InboxViewModel {
    let client: BridgeClient
    private(set) var hitl: [HitlItem] = []
    private(set) var error: String?
    var loading = true

    init(client: BridgeClient) { self.client = client }

    var unread: [HitlItem] { hitl.filter(\.isUnread) }
    var open: [HitlItem] { hitl.filter { !$0.isResolved } }
    var archived: [HitlItem] { hitl.filter(\.isResolved) }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            let (_, fresh) = try await client.remote()
            // Keep any optimistic read-state we applied so an item doesn't flash
            // unread mid-poll.
            let readLocally = Set(hitl.filter { $0.readAt != nil }.map(\.id))
            hitl = fresh.map { $0.markingReadIfIn(readLocally) }
            error = nil
            syncBadge()
        } catch { self.error = error.localizedDescription }
    }

    @MainActor
    func resolve(_ item: HitlItem, approved: Bool) async {
        hitl.removeAll { $0.id == item.id }
        try? await client.resolveHitl(id: item.id, resolved: approved)
        await refresh()
    }

    /// Mark read — optimistic locally, persisted + badge-synced in the background.
    @MainActor
    func markRead(_ items: [HitlItem]) {
        let ids = items.filter(\.isUnread).map(\.id)
        guard !ids.isEmpty else { return }
        hitl = hitl.map { ids.contains($0.id) ? $0.markedRead() : $0 }
        syncBadge()
        Task { try? await client.markHitlRead(ids: ids) }
    }

    @MainActor
    func markAllRead() { markRead(hitl) }

    /// The app icon badge should track UNREAD, and clear as you read — iOS keeps
    /// it until the app resets it, which is why a stale "1" lingered.
    private func syncBadge() {
        UNUserNotificationCenter.current().setBadgeCount(unread.count)
    }
}

/// Global, cross-workspace: everything that needs you, read like email — a list
/// of subjects; tap one to read the full body.
struct InboxView: View {
    @State var model: InboxViewModel
    @State private var archive = false

    private var shown: [HitlItem] { archive ? model.archived : model.open }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                LazyVStack(spacing: 8) {
                    if let error = model.error {
                        GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                    }
                    if shown.isEmpty && !model.loading {
                        GTPanel {
                            Text(archive ? "Nothing archived yet." : "Inbox zero.")
                                .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                        }
                    }
                    ForEach(shown) { item in
                        NavigationLink {
                            InboxDetailView(item: item) { approved in
                                Task { await model.resolve(item, approved: approved) }
                            }
                            .onAppear { model.markRead([item]) }
                        } label: {
                            InboxRow(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(14)
            }
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
        }
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("", selection: $archive) {
                    Text(model.unread.isEmpty ? "Inbox" : "Inbox (\(model.unread.count))").tag(false)
                    Text("Archive").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 200)
            }
            ToolbarItem(placement: .topBarTrailing) {
                if !model.unread.isEmpty {
                    Button("Read all") { model.markAllRead() }.font(GT.sans(13))
                }
            }
        }
        .task {
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}

/// One subject line — bold when unread, a severity tag, source + time. No body.
private struct InboxRow: View {
    let item: HitlItem
    var body: some View {
        GTPanel(padding: 11) {
            HStack(spacing: 8) {
                Circle()
                    .fill(item.isUnread ? GT.accent : Color.clear)
                    .frame(width: 6, height: 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(GT.sans(14, item.isUnread ? .semibold : .medium))
                        .foregroundStyle(item.isResolved ? GT.textMuted : GT.text)
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        Text(item.source).font(GT.mono(10)).foregroundStyle(GT.textFaint)
                        if let repo = item.repo, !repo.isEmpty {
                            Text("· \(repo)").font(GT.mono(10)).foregroundStyle(GT.textFaint)
                        }
                        Text("· \(relativeTime(item.createdAt))")
                            .font(GT.mono(10)).foregroundStyle(GT.textFaint)
                    }
                    .lineLimit(1)
                }
                Spacer(minLength: 4)
                SeverityTag(severity: item.severity)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(GT.textFaint)
            }
        }
    }
}

/// The opened email: full body rendered as Markdown, with actions.
private struct InboxDetailView: View {
    let item: HitlItem
    let onResolve: (Bool) -> Void
    @Environment(\.dismiss) private var dismiss

    private var body_: String {
        [item.action, item.detail].compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(item.title).font(GT.sans(18, .semibold)).foregroundStyle(GT.text)
                    HStack(spacing: 6) {
                        SeverityTag(severity: item.severity)
                        Text(item.source).font(GT.mono(11)).foregroundStyle(GT.textFaint)
                        if let repo = item.repo, !repo.isEmpty {
                            Text("· \(repo)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                        }
                        Text("· \(relativeTime(item.createdAt))")
                            .font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                    if body_.isEmpty {
                        Text("No details.").font(GT.sans(13)).foregroundStyle(GT.textMuted)
                    } else {
                        MarkdownText(raw: body_)
                    }
                    if !item.isResolved {
                        HStack(spacing: 10) {
                            Button("Dismiss") {
                                onResolve(false)
                                dismiss()
                            }
                            .gtSecondaryButton()
                            Button("Resolve") {
                                onResolve(true)
                                dismiss()
                            }
                            .font(GT.sans(14, .semibold))
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(GT.green)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .padding(.top, 4)
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

/// 3-tier severity tag; legacy 'push' reads as urgent.
private struct SeverityTag: View {
    let severity: String?
    private var tier: (String, Color) {
        switch severity {
        case "normal": return ("normal", GT.accentLight)
        case "low": return ("low", GT.textFaint)
        default: return ("urgent", GT.yellow)  // 'urgent' | legacy 'push' | nil
        }
    }
    var body: some View {
        Text(tier.0)
            .font(GT.sans(9, .semibold))
            .foregroundStyle(tier.1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(tier.1.opacity(0.12))
            .clipShape(Capsule())
    }
}
