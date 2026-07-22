import SwiftUI

@Observable
final class RemoteListViewModel {
    private(set) var sessions: [RemoteSession] = []
    private(set) var hitl: [HitlItem] = []
    private(set) var error: String?
    private(set) var loading = true

    let client: BridgeClient

    init(client: BridgeClient) {
        self.client = client
    }

    /// Ended sessions stay listed until they age out of the Mac's store, but
    /// they belong below the ones still running.
    var active: [RemoteSession] { sessions.filter { !$0.hasEnded } }
    var finished: [RemoteSession] { sessions.filter(\.hasEnded) }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            let (sessions, hitl) = try await client.remote()
            self.sessions = sessions
            self.hitl = hitl
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func resolve(_ item: HitlItem, approved: Bool) async {
        // Optimistic: the queue should feel instant, and the next poll
        // reconciles if the Mac disagreed.
        hitl.removeAll { $0.id == item.id }
        try? await client.resolveHitl(id: item.id, resolved: approved)
        await refresh()
    }

    /// Terminate a running session — it drops to Finished.
    @MainActor
    func terminate(_ session: RemoteSession) async {
        try? await client.endSession(id: session.id)
        await refresh()
    }

    /// Remove a session for good — optimistically drop it from the list.
    @MainActor
    func delete(_ session: RemoteSession) async {
        sessions.removeAll { $0.id == session.id }
        try? await client.deleteSession(id: session.id)
        await refresh()
    }

    /// Delete every finished session at once.
    @MainActor
    func clearFinished() async {
        let ids = finished.map(\.id)
        sessions.removeAll { $0.hasEnded }
        for id in ids { try? await client.deleteSession(id: id) }
        await refresh()
    }
}

/// Home: every session that registered itself, plus the blocked queue.
struct RemoteListView: View {
    @State var model: RemoteListViewModel
    let onUnpair: () -> Void
    @State private var opened: RemoteSession?
    @State private var startingNew = false

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let error = model.error {
                        GTPanel {
                            Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow)
                        }
                    }

                    if !model.hitl.isEmpty {
                        section("Needs you", count: model.hitl.count, tint: GT.yellow)
                        ForEach(model.hitl) { item in
                            HitlCard(item: item) { approved in
                                Task { await model.resolve(item, approved: approved) }
                            }
                        }
                    }

                    section("Sessions", count: model.active.count, tint: GT.textFaint)
                    if model.active.isEmpty && !model.loading {
                        GTPanel {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("No sessions registered")
                                    .font(GT.sans(13, .medium))
                                    .foregroundStyle(GT.text)
                                Text(
                                    "In a session on your Mac, run /remote-terminal and it will appear here."
                                )
                                .font(GT.sans(12))
                                .foregroundStyle(GT.textMuted)
                            }
                        }
                    }
                    ForEach(model.active) { session in
                        NavigationLink(value: session) { SessionRow(session: session) }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("Terminate", systemImage: "stop.circle") {
                                    Task { await model.terminate(session) }
                                }
                                Button("Delete", systemImage: "trash", role: .destructive) {
                                    Task { await model.delete(session) }
                                }
                            }
                    }

                    Button { startingNew = true } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "plus")
                            Text("New session")
                        }
                        .frame(maxWidth: .infinity)
                        .gtSecondaryButton()
                    }
                    .padding(.top, 4)

                    if !model.finished.isEmpty {
                        HStack {
                            section("Finished", count: model.finished.count, tint: GT.textFaint)
                            Spacer()
                            Button("Clear") { Task { await model.clearFinished() } }
                                .font(GT.sans(12, .medium))
                                .foregroundStyle(GT.textMuted)
                        }
                        .padding(.top, 6)
                        ForEach(model.finished) { session in
                            NavigationLink(value: session) { SessionRow(session: session) }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    Button("Delete", systemImage: "trash", role: .destructive) {
                                        Task { await model.delete(session) }
                                    }
                                }
                        }
                    }
                }
                .padding(14)
            }
        }
        .navigationDestination(for: RemoteSession.self) { session in
            RemoteThreadView(model: RemoteThreadViewModel(session: session, client: model.client))
        }
        // A tapped notification names a session; open it once the list knows it.
        .navigationDestination(item: $opened) { session in
            RemoteThreadView(model: RemoteThreadViewModel(session: session, client: model.client))
        }
        .sheet(isPresented: $startingNew) {
            NewSessionSheet(client: model.client) { newId in
                await model.refresh()
                // Open the freshly-started thread; it registered before the
                // agent booted, so it's already in the list.
                await MainActor.run { opened = model.sessions.first { $0.id == newId } }
            }
        }
        .navigationTitle(model.client.pairing.n)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
        .refreshable { await model.refresh() }
        .task {
            while !Task.isCancelled {
                await model.refresh()
                openPendingIfAny()
                try? await Task.sleep(for: .seconds(4))
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Unpair this Mac", role: .destructive, action: onUnpair)
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(GT.textMuted)
                }
            }
        }
    }

    private func openPendingIfAny() {
        guard let id = PushRegistrar.shared.pendingThreadKey,
            let session = model.sessions.first(where: { $0.id == id })
        else { return }
        PushRegistrar.shared.pendingThreadKey = nil
        opened = session
    }

    private func section(_ title: String, count: Int, tint: Color) -> some View {
        HStack(spacing: 6) {
            Text(title.uppercased())
                .font(GT.sans(10, .semibold))
                .tracking(0.8)
                .foregroundStyle(tint)
            Text("\(count)").font(GT.mono(10)).foregroundStyle(GT.textFaint)
            Spacer()
        }
    }
}

private struct SessionRow: View {
    let session: RemoteSession

    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                GTStatusDot(status: session.hasEnded ? "ended" : "working")
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
                } else if session.hasEnded {
                    Text("done").font(GT.sans(10)).foregroundStyle(GT.textFaint)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(GT.textFaint)
            }
        }
    }
}

/// A blocked agent, with the same approve/deny affordance Telegram gets.
struct HitlCard: View {
    let item: HitlItem
    let onResolve: (Bool) -> Void

    var body: some View {
        GTPanel {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(GT.yellow)
                    Text(item.title).font(GT.sans(14, .medium)).foregroundStyle(GT.text)
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
