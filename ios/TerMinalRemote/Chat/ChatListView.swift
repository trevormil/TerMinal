import SwiftUI

@Observable
final class ChatListViewModel {
    private(set) var threads: [ChatThread] = []
    private(set) var hitl: [HitlItem] = []
    private(set) var error: String?
    private(set) var loading = true

    let client: BridgeClient

    init(client: BridgeClient) {
        self.client = client
    }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            let (threads, hitl) = try await client.chats()
            self.threads = threads
            self.hitl = hitl
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    var live: [ChatThread] { threads.filter(\.live) }
    var past: [ChatThread] { threads.filter { !$0.live } }

    @MainActor
    func resolve(_ item: HitlItem, approved: Bool) async {
        // Optimistic: the queue should feel instant, and the next poll
        // reconciles if the Mac disagreed.
        hitl.removeAll { $0.id == item.id }
        try? await client.resolveHitl(id: item.id, resolved: approved)
        await refresh()
    }
}

/// The app's home: every live session as a conversation, plus the blocked queue.
struct ChatListView: View {
    @State var model: ChatListViewModel
    let onUnpair: () -> Void
    @State private var startingNew = false
    @State private var opened: ChatThread?

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let error = model.error {
                        GTPanel {
                            Text(error)
                                .font(GT.sans(12))
                                .foregroundStyle(GT.yellow)
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

                    section("Sessions", count: model.live.count, tint: GT.textFaint)
                    if model.live.isEmpty && !model.loading {
                        GTPanel {
                            Text("No sessions running. Start one below, or from TerMinal on your Mac.")
                                .font(GT.sans(12))
                                .foregroundStyle(GT.textMuted)
                        }
                    }
                    ForEach(model.live) { thread in
                        NavigationLink(value: thread) { ThreadRow(thread: thread) }
                            .buttonStyle(.plain)
                    }

                    if !model.past.isEmpty {
                        section("Recent", count: model.past.count, tint: GT.textFaint)
                            .padding(.top, 6)
                        ForEach(model.past) { thread in
                            NavigationLink(value: thread) { ThreadRow(thread: thread) }
                                .buttonStyle(.plain)
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
                }
                .padding(14)
            }
        }
        // A tapped notification names a thread; open it once the list knows
        // about it, then clear so it doesn't re-open on every refresh.
        .navigationDestination(item: $opened) { thread in
            ChatThreadView(model: ChatThreadViewModel(thread: thread, client: model.client))
        }
        .navigationDestination(for: ChatThread.self) { thread in
            ChatThreadView(
                model: ChatThreadViewModel(thread: thread, client: model.client))
        }
        .navigationTitle(model.client.pairing.n)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
        .refreshable { await model.refresh() }
        .sheet(isPresented: $startingNew) {
            NewSessionSheet(client: model.client) { await model.refresh() }
        }
        .task {
            while !Task.isCancelled {
                await model.refresh()
                try? await Task.sleep(for: .seconds(4))
                openPendingThreadIfAny()
            }
        }
        .onAppear { openPendingThreadIfAny() }
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

    private func openPendingThreadIfAny() {
        guard let key = PushRegistrar.shared.pendingThreadKey,
            let thread = model.threads.first(where: { $0.key == key })
        else { return }
        PushRegistrar.shared.pendingThreadKey = nil
        opened = thread
    }

    private func section(_ title: String, count: Int, tint: Color) -> some View {
        HStack(spacing: 6) {
            Text(title.uppercased())
                .font(GT.sans(10, .semibold))
                .tracking(0.8)
                .foregroundStyle(tint)
            Text("\(count)")
                .font(GT.mono(10))
                .foregroundStyle(GT.textFaint)
            Spacer()
        }
    }
}

private struct ThreadRow: View {
    let thread: ChatThread

    var body: some View {
        GTPanel {
            HStack(spacing: 10) {
                GTStatusDot(status: thread.status)
                VStack(alignment: .leading, spacing: 3) {
                    Text(thread.name)
                        .font(GT.sans(15, .medium))
                        .foregroundStyle(GT.text)
                    HStack(spacing: 5) {
                        if !thread.repo.isEmpty { Text(thread.repo) }
                        if !thread.branch.isEmpty { Text("· \(thread.branch)") }
                        Text("· \(thread.engine)")
                    }
                    .font(GT.mono(11))
                    .foregroundStyle(GT.textFaint)
                    .lineLimit(1)
                }
                Spacer(minLength: 6)
                if !thread.live {
                    Text(thread.status)
                        .font(GT.sans(10))
                        .foregroundStyle(GT.textFaint)
                } else if thread.needsInput {
                    Text("your turn")
                        .font(GT.sans(10, .semibold))
                        .foregroundStyle(GT.accent2)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(GT.accent2.opacity(0.12))
                        .clipShape(Capsule())
                } else {
                    Text("working")
                        .font(GT.sans(10))
                        .foregroundStyle(GT.textFaint)
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
                    Text(item.title)
                        .font(GT.sans(14, .medium))
                        .foregroundStyle(GT.text)
                }
                if let detail = item.detail, !detail.isEmpty {
                    Text(detail)
                        .font(GT.sans(12))
                        .foregroundStyle(GT.textMuted)
                        .lineLimit(6)
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
                    Button("Dismiss") { onResolve(false) }
                        .gtSecondaryButton()
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
