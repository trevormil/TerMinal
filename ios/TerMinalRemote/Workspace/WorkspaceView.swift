import SwiftUI

@Observable
final class WorkspaceViewModel {
    let client: BridgeClient
    let repo: RepoOption

    private(set) var sessions: [RemoteSession] = []
    private(set) var tickets: [WsTicket] = []
    private(set) var prs: [WsPr] = []
    private(set) var runs: [WsRun] = []
    private(set) var schedules: [WsSchedule] = []
    private(set) var error: String?
    var loading = false

    init(client: BridgeClient, repo: RepoOption) {
        self.client = client
        self.repo = repo
    }

    /// Sessions registered in this repo (the bridge lists them all; filter here).
    @MainActor
    func loadSessions() async {
        do {
            let (all, _) = try await client.remote()
            sessions = all.filter { $0.repo == repo.name || $0.repo == repo.path }
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    @MainActor
    func load(_ tab: WorkspaceTab) async {
        loading = true
        defer { loading = false }
        do {
            switch tab {
            case .sessions: await loadSessions()
            case .tickets: tickets = try await client.tickets(repo: repo.path)
            case .prs: prs = try await client.prs(repo: repo.path)
            case .runs: runs = try await client.runs(repo: repo.path)
            case .schedules: schedules = try await client.schedules(repo: repo.path)
            }
            if tab != .sessions { error = nil }
        } catch { self.error = error.localizedDescription }
    }

    @MainActor func terminate(_ s: RemoteSession) async {
        try? await client.endSession(id: s.id)
        await loadSessions()
    }
    @MainActor func delete(_ s: RemoteSession) async {
        sessions.removeAll { $0.id == s.id }
        try? await client.deleteSession(id: s.id)
        await loadSessions()
    }
}

enum WorkspaceTab: String, CaseIterable, Identifiable {
    case sessions, tickets, prs, runs, schedules
    var id: String { rawValue }
    var label: String {
        switch self {
        case .sessions: return "Sessions"
        case .tickets: return "Tickets"
        case .prs: return "PRs"
        case .runs: return "Runs"
        case .schedules: return "Schedules"
        }
    }
}

/// One repo's cockpit: sessions you can steer, plus read-only tickets/PRs/runs/
/// schedules — the desktop tabs, phone-sized.
struct WorkspaceView: View {
    @State var model: WorkspaceViewModel
    @State private var tab: WorkspaceTab = .sessions
    @State private var startingNew = false
    @State private var opened: RemoteSession?

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Picker("Tab", selection: $tab) {
                    ForEach(WorkspaceTab.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if let error = model.error {
                            GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                        }
                        content
                    }
                    .padding(14)
                }
                .refreshable { await model.load(tab) }
            }
        }
        .navigationTitle(model.repo.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .navigationDestination(for: RemoteSession.self) { s in
            RemoteThreadView(model: RemoteThreadViewModel(session: s, client: model.client))
        }
        .sheet(isPresented: $startingNew) {
            NewSessionSheet(client: model.client) { _ in await model.loadSessions() }
        }
        .task(id: tab) { await model.load(tab) }
    }

    @ViewBuilder private var content: some View {
        switch tab {
        case .sessions:
            sessionsTab
        case .tickets:
            list(model.tickets, empty: "No tickets") { t in
                NavigationLink {
                    TicketDetailView(client: model.client, repo: model.repo.path, slug: t.slug)
                } label: { TicketRow(t: t) }
                .buttonStyle(.plain)
            }
        case .prs:
            list(model.prs, empty: "No open PRs") { pr in
                NavigationLink {
                    PrDetailView(client: model.client, repo: model.repo.path, iid: pr.iid)
                } label: { PrRow(pr: pr) }
                .buttonStyle(.plain)
            }
        case .runs:
            list(model.runs, empty: "No runs yet") { run in
                NavigationLink {
                    RunDetailView(client: model.client, run: run)
                } label: { RunRow(run: run) }
                .buttonStyle(.plain)
            }
        case .schedules:
            list(model.schedules, empty: "No schedules") { s in
                NavigationLink {
                    ScheduleDetailView(client: model.client, repo: model.repo.path, id: s.id)
                } label: { ScheduleRow(s: s) }
                .buttonStyle(.plain)
            }
        }
    }

    private var sessionsTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.sessions.isEmpty && !model.loading {
                GTPanel {
                    Text("No sessions in this repo. Start one, or run /remote-terminal on your Mac.")
                        .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                }
            }
            ForEach(model.sessions) { s in
                NavigationLink(value: s) { SessionRow(session: s) }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Terminate", systemImage: "stop.circle") {
                            Task { await model.terminate(s) }
                        }
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            Task { await model.delete(s) }
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
            .padding(.top, 2)
        }
    }

    @ViewBuilder
    private func list<T: Identifiable, Row: View>(
        _ items: [T], empty: String, @ViewBuilder row: @escaping (T) -> Row
    ) -> some View {
        if items.isEmpty && !model.loading {
            GTPanel { Text(empty).font(GT.sans(12)).foregroundStyle(GT.textMuted) }
        }
        ForEach(items) { row($0) }
    }
}
