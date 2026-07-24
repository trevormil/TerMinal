import SwiftUI

/// Reads from the shared RemoteFeed (polled once at the app root) rather than
/// running its own fetch loop against the same endpoint.
@Observable
final class InboxViewModel {
    let feed: RemoteFeed
    private var client: BridgeClient { feed.client }

    init(feed: RemoteFeed) { self.feed = feed }

    var hitl: [HitlItem] { feed.hitl }
    var error: String? { feed.error }
    var loading: Bool { feed.loading }

    var unread: [HitlItem] { hitl.filter(\.isUnread) }
    var open: [HitlItem] { hitl.filter { !$0.isResolved } }
    var archived: [HitlItem] { hitl.filter(\.isResolved) }

    @MainActor
    func refresh() async { await feed.refresh() }

    @MainActor
    func resolve(_ item: HitlItem, approved: Bool) async {
        feed.removeHitl(id: item.id)
        try? await client.resolveHitl(id: item.id, resolved: approved)
        await feed.refresh()
    }

    /// Mark read — optimistic locally, persisted + badge-synced in the background.
    @MainActor
    func markRead(_ items: [HitlItem]) {
        let ids = items.filter(\.isUnread).map(\.id)
        guard !ids.isEmpty else { return }
        feed.markHitlRead(ids: ids)
        Task { try? await client.markHitlRead(ids: ids) }
    }

    /// Back on the unread pile — email parity with "mark as unread".
    @MainActor
    func markUnread(_ item: HitlItem) {
        guard item.readAt != nil else { return }
        feed.markHitlRead(ids: [item.id], read: false)
        Task { try? await client.markHitlRead(ids: [item.id], read: false) }
    }

    @MainActor
    func markAllRead() { markRead(hitl) }
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
            // A real List (not a LazyVStack) so rows get native swipe actions.
            List {
                if let error = model.error {
                    GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                        .plainRow()
                }
                if shown.isEmpty && !model.loading {
                    GTPanel {
                        Text(archive ? "Nothing archived yet." : "Inbox zero.")
                            .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                    }
                    .plainRow()
                }
                ForEach(shown) { item in
                    // Chevron lives INSIDE the card (InboxRow draws it); the
                    // native List accessory is suppressed by hiding the link.
                    InboxRow(item: item)
                        .background(
                            NavigationLink {
                                InboxDetailView(
                                    item: item,
                                    onResolve: { approved in
                                        Task { await model.resolve(item, approved: approved) }
                                    },
                                    live: { id in model.hitl.first { $0.id == id } }
                                )
                                .onAppear { model.markRead([item]) }
                            } label: { EmptyView() }
                            .opacity(0)
                        )
                        .plainRow()
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        if item.isUnread {
                            Button {
                                model.markRead([item])
                            } label: {
                                Label("Read", systemImage: "envelope.open")
                            }
                            .tint(GT.accent)
                        } else if !item.isResolved {
                            Button {
                                model.markUnread(item)
                            } label: {
                                Label("Unread", systemImage: "envelope.badge")
                            }
                            .tint(GT.accent)
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        if archive {
                            Button {
                                Task { await model.resolve(item, approved: false) }
                            } label: {
                                Label("Reopen", systemImage: "arrow.uturn.backward")
                            }
                            .tint(.orange)
                        } else {
                            Button {
                                Task { await model.resolve(item, approved: true) }
                            } label: {
                                Label("Archive", systemImage: "checkmark")
                            }
                            .tint(GT.green)
                        }
                    }
                    .contextMenu {
                        if item.isUnread {
                            Button("Mark read", systemImage: "envelope.open") {
                                model.markRead([item])
                            }
                        } else if !item.isResolved {
                            Button("Mark unread", systemImage: "envelope.badge") {
                                model.markUnread(item)
                            }
                        }
                        if archive {
                            Button("Reopen", systemImage: "arrow.uturn.backward") {
                                Task { await model.resolve(item, approved: false) }
                            }
                        } else {
                            Button("Archive", systemImage: "checkmark") {
                                Task { await model.resolve(item, approved: true) }
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
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
    /// Live view of the item, so a resolve from anywhere (desktop, swipe,
    /// another device) updates the buttons — `item` alone is a snapshot from
    /// push time.
    var live: (String) -> HitlItem? = { _ in nil }
    @Environment(\.dismiss) private var dismiss

    private var current: HitlItem { live(item.id) ?? item }

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
                    if current.isResolved {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(GT.green)
                            Text("Resolved").font(GT.sans(13)).foregroundStyle(GT.textMuted)
                            Spacer()
                            Button("Reopen") {
                                onResolve(false)
                                dismiss()
                            }
                            .gtSecondaryButton()
                        }
                        .padding(.top, 4)
                    } else {
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
