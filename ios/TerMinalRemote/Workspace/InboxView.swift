import SwiftUI

@Observable
final class InboxViewModel {
    let client: BridgeClient
    private(set) var hitl: [HitlItem] = []
    private(set) var error: String?
    var loading = true

    init(client: BridgeClient) { self.client = client }

    var unread: [HitlItem] { hitl.filter(\.isUnread) }
    var open: [HitlItem] { hitl.filter { !$0.isResolved } }
    var resolved: [HitlItem] { hitl.filter(\.isResolved) }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            let (_, hitl) = try await client.remote()
            // Merge server truth but keep any optimistic read-state we already
            // applied, so a mid-poll refresh doesn't make an item flash unread.
            let readLocally = Set(self.hitl.filter { $0.readAt != nil }.map(\.id))
            self.hitl = hitl.map { item in
                readLocally.contains(item.id) && item.readAt == nil
                    ? HitlItem(
                        id: item.id, title: item.title, detail: item.detail, action: item.action,
                        repo: item.repo, source: item.source, createdAt: item.createdAt,
                        severity: item.severity, status: item.status, readAt: Date().timeIntervalSince1970 * 1000)
                    : item
            }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    @MainActor
    func resolve(_ item: HitlItem, approved: Bool) async {
        hitl.removeAll { $0.id == item.id }
        try? await client.resolveHitl(id: item.id, resolved: approved)
        await refresh()
    }

    /// Mark items read — optimistic locally, persisted in the background.
    @MainActor
    func markRead(_ items: [HitlItem]) {
        let ids = items.filter(\.isUnread).map(\.id)
        guard !ids.isEmpty else { return }
        let now = Date().timeIntervalSince1970 * 1000
        hitl = hitl.map { h in
            ids.contains(h.id)
                ? HitlItem(
                    id: h.id, title: h.title, detail: h.detail, action: h.action, repo: h.repo,
                    source: h.source, createdAt: h.createdAt, severity: h.severity,
                    status: h.status, readAt: now)
                : h
        }
        Task { try? await client.markHitlRead(ids: ids) }
    }
}

enum InboxFilter: String, CaseIterable, Identifiable {
    case unread, open, resolved, all
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

/// Global, cross-workspace: everything that needs you, with read/unread and a
/// severity that says whether it pinged you (push) or just waits (normal).
struct InboxView: View {
    @State var model: InboxViewModel
    @State private var filter: InboxFilter = .open

    private var shown: [HitlItem] {
        switch filter {
        case .unread: return model.unread
        case .open: return model.open
        case .resolved: return model.resolved
        case .all: return model.hitl
        }
    }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Picker("Filter", selection: $filter) {
                    ForEach(InboxFilter.allCases) { f in
                        Text(counted(f)).tag(f)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if let error = model.error {
                            GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                        }
                        if shown.isEmpty && !model.loading {
                            GTPanel {
                                Text(emptyText)
                                    .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                            }
                        }
                        ForEach(shown) { item in
                            InboxCard(item: item) { approved in
                                Task { await model.resolve(item, approved: approved) }
                            }
                            .onAppear { model.markRead([item]) }
                        }
                    }
                    .padding(14)
                }
                .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
                .refreshable { await model.refresh() }
            }
        }
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            if !model.unread.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Mark all read") { model.markRead(model.hitl) }
                        .font(GT.sans(13))
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

    private func counted(_ f: InboxFilter) -> String {
        let n: Int
        switch f {
        case .unread: n = model.unread.count
        case .open: n = model.open.count
        case .resolved: n = model.resolved.count
        case .all: n = model.hitl.count
        }
        return n > 0 ? "\(f.label) \(n)" : f.label
    }

    private var emptyText: String {
        switch filter {
        case .resolved: return "Nothing resolved yet."
        case .unread: return "Inbox zero — nothing unread."
        default: return "Nothing needs you. Agents that get blocked show up here."
        }
    }
}

/// One inbox item: unread dot, severity, and approve/dismiss for open items.
private struct InboxCard: View {
    let item: HitlItem
    let onResolve: (Bool) -> Void

    var body: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    if item.isUnread {
                        Circle().fill(GT.accent).frame(width: 6, height: 6)
                    }
                    Image(systemName: item.isResolved ? "checkmark.circle" : "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(item.isResolved ? GT.textFaint : GT.yellow)
                    Text(item.title)
                        .font(GT.sans(14, item.isUnread ? .semibold : .medium))
                        .foregroundStyle(item.isResolved ? GT.textMuted : GT.text)
                    Spacer(minLength: 4)
                    pill(item.isNormal ? "normal" : "push", tint: item.isNormal ? GT.textFaint : GT.accentLight)
                }
                if let detail = item.detail, !detail.isEmpty {
                    Text(detail).font(GT.sans(12)).foregroundStyle(GT.textMuted).lineLimit(6)
                }
                if let action = item.action, !action.isEmpty {
                    Text(action)
                        .font(GT.mono(11))
                        .foregroundStyle(GT.accentLight)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(GT.codeBg)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                }
                HStack(spacing: 8) {
                    if let repo = item.repo, !repo.isEmpty {
                        Text(repo).font(GT.mono(10)).foregroundStyle(GT.textFaint)
                    }
                    Spacer()
                    if !item.isResolved {
                        Button("Dismiss") { onResolve(false) }.gtSecondaryButton()
                        Button("Resolve") { onResolve(true) }
                            .font(GT.sans(13, .semibold))
                            .foregroundStyle(.black)
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .background(GT.green)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }
}
